"""Classes for specific report types."""

from datetime import datetime, timedelta
from io import BytesIO
from os import path
from typing import Dict, List, Optional
import copy

from operator import attrgetter
from dateutil import parser
from pytz import utc
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import NextPageTemplate, Paragraph, Table, TableStyle
from reportlab.platypus.doctemplate import BaseDocTemplate, PageTemplate
from reportlab.platypus.frames import Frame
from sqlalchemy import and_, func, or_, select
from sqlalchemy.dialects.postgresql import INTERVAL

from api.models import Event, Project, Work, WorkStatus, WorkType, db
from api.models.event_category import EventCategoryEnum
from api.models.event_configuration import EventConfiguration
from api.models.event_type import EventTypeEnum
from api.models.special_field import EntityEnum
from api.models.work import WorkStateEnum
from api.models.work_issues import WorkIssues
from api.models.work_issue_updates import WorkIssueUpdates
from api.services.special_field import SpecialFieldService
from api.services.work_issues import WorkIssuesService
from api.schemas import response as res
from api.utils.constants import CANADA_TIMEZONE
from api.utils.enums import StalenessEnum
from api.utils.util import process_data
from api.utils.draftjs_extractor import draftjs_extractor

from .report_factory import ReportFactory


# pylint:disable=not-callable,no-member


class ThirtySixtyNinetyReport(ReportFactory):
    """EA 30-60-90 Report Generator"""

    def __init__(self, filters, color_intensity):
        """Initialize the ReportFactory"""
        data_keys = [
            "actual_date",
            "anticipated_decision_date",
            "decision_information",
            "event_configuration_id",
            "event_date",
            "event_description",
            "event_id",
            "event_title",
            "event_type_id",
            "milestone_id",
            "pecp_explanation",
            "project_id",
            "project_name",
            "status_date_updated",
            "work_id",
            "work_report_title",
            "work_short_description",
            "work_status_text",
        ]
        group_by = "work_id"
        self.event_order = {
            "decision_referral": 1,
            "work_issue": 2,
            "pcp": 3,
            "other": 4,
        }
        super().__init__(
            color_intensity=color_intensity,
            filters=filters,
            data_keys=data_keys,
            group_by=group_by,
            template_name=None
                        )
        self.report_date = None
        self.report_title = "30-60-90"
        self.pecp_configuration_ids = (
            db.session.execute(
                select(EventConfiguration.id).where(
                    EventConfiguration.event_category_id == EventCategoryEnum.PCP.value,
                )
            )
            .scalars()
            .all()
        )
        self.decision_configuration_ids = (
            db.session.execute(
                select(EventConfiguration.id).where(
                    EventConfiguration.event_type_id.in_(
                        [
                            EventTypeEnum.MINISTER_DECISION.value,
                            EventTypeEnum.CEAO_DECISION.value,
                            EventTypeEnum.EAC_MINISTER.value
                        ]
                    )
                )
            )
            .scalars()
            .all()
        )
        self.high_profile_work_issue_work_ids = (
            db.session.execute(
                select(WorkIssues.work_id).where(
                    WorkIssues.is_active.is_(True),
                    WorkIssues.is_high_priority.is_(True),
                    WorkIssues.is_resolved.is_(False)
                )
            )
            .scalars()
            .all()
        )

    def _fetch_data(self, report_date):
        """Fetches the relevant data for EA 30-60-90 Report"""
        max_date = report_date + timedelta(days=93)
        next_pecp_query = self._get_next_pcp_query(report_date, max_date)
        valid_event_ids = self._get_valid_event_ids(report_date)
        work_issue_work_ids = self._get_valid_work_issue_work_ids(report_date)
        latest_status_updates = self._get_latest_status_update_query()

        results_qry = (
            Work.query.filter(
                Work.is_active.is_(True),
                Work.is_deleted.is_(False),
                Work.work_state.in_(
                    [WorkStateEnum.IN_PROGRESS.value, WorkStateEnum.SUSPENDED.value]
                ),
            )
            .join(Project, Work.project)
            .join(WorkType, Work.work_type)
            .outerjoin(
                Event,
                and_(
                    Event.work,
                    Event.id.in_(valid_event_ids),
                ),)
            .outerjoin(EventConfiguration, EventConfiguration.id == Event.event_configuration_id)
            .outerjoin(latest_status_updates, latest_status_updates.c.work_id == Work.id)
            .outerjoin(next_pecp_query, next_pecp_query.c.work_id == Work.id)
            .outerjoin(WorkStatus)
            .filter(
                or_(
                    # Include Works with valid work issues
                    Work.id.in_(work_issue_work_ids),
                    # Include Works with valid events
                    and_(
                        Event.id.isnot(None),
                        Event.id.in_(valid_event_ids),
                    ),
                )
            )
            .add_columns(
                Project.name.label("project_name"),
                WorkType.report_title.label("work_report_title"),
                (
                    Event.anticipated_date
                    + func.cast(func.concat(func.coalesce(Event.number_of_days, 0), " DAYS"), INTERVAL)
                ).label("anticipated_decision_date"),
                Event.actual_date.label("actual_date"),
                Work.report_description.label("work_short_description"),
                Event.notes.label("decision_information"),
                Event.description.label("event_description"),
                next_pecp_query.c.topic.label("pecp_explanation"),
                latest_status_updates.c.posted_date.label("status_date_updated"),
                latest_status_updates.c.description.label("work_status_text"),
                Work.id.label("work_id"),
                Event.id.label("event_id"),
                Event.name.label("event_title"),
                func.coalesce(Event.actual_date, Event.anticipated_date).label(
                    "event_date"
                ),
                EventConfiguration.id.label("event_configuration_id"),
                EventConfiguration.event_type_id.label("event_type_id"),
                EventConfiguration.event_category_id.label("milestone_id"),
                Project.id.label("project_id"),
            )
        )

        return results_qry.all()

    def _format_data(self, data: List[Dict], report_title: Optional[str] = None) -> Dict:
        """
        Formats and categorizes event data into 30-, 60-, and 90-day intervals based on event dates.

        This method processes the provided data by:
        1. Resolving multiple events using `_resolve_multiple_events`.
        2. Updating work issues for the first event using `_update_work_issues`.
        3. Categorizing the formatted events into 30-, 60-, and 90-day intervals relative to the report date.
        4. Retrieving and applying project-specific history to the earliest event in each interval.
        """
        data = super()._format_data(data)
        # Get work issues for work first event
        data = self._update_work_issues(data)
        data = self._resolve_multiple_events(data)
        data = self._format_notes(data)
        response = {
            "30": [],
            "60": [],
            "90": [],
        }
        works = [group["items"][0] for group in data]
        project_special_history = self._get_project_special_history(works)
        for group in data:
            first_event = group["items"][0]
            first_event_date = first_event["event_date"]
            if first_event_date <= (self.report_date + timedelta(days=30)):
                special_history = self._get_project_special_history_id(
                    first_event["project_id"], project_special_history[30], first_event_date
                )
                if special_history:
                    first_event["project_name"] = special_history.field_value
                response["30"].append(group)
            elif first_event_date <= (self.report_date + timedelta(days=60)):
                special_history = self._get_project_special_history_id(
                    first_event["project_id"], project_special_history[60], first_event_date
                )
                if special_history:
                    first_event["project_name"] = special_history.field_value
                response["60"].append(group)
            elif first_event_date <= (self.report_date + timedelta(days=93)):
                special_history = self._get_project_special_history_id(
                    first_event["project_id"], project_special_history[90], first_event_date
                )
                if special_history:
                    first_event["project_name"] = special_history.field_value
                response["90"].append(group)
        for _, value in response.items():
            value.sort(key=lambda work: work["items"][0]["event_date"])
        return response

    def _update_work_issues(self, data) -> List[WorkIssues]:
        """Combine the result with work issues"""
        work_ids = set((work["group"] for work in data))
        work_issues = WorkIssuesService.find_work_issues_by_work_ids(work_ids)
        for group in data:
            result_item = group["items"][0]
            issue_per_work = [
                issue
                for issue in work_issues
                if issue.work_id == result_item.get("work_id")
                and issue.is_high_priority is True
            ]
            for issue in issue_per_work:
                latest_update = max(
                    (
                        issue_update
                        for issue_update in issue.updates
                        if issue_update.is_approved
                    ),
                    key=attrgetter("posted_date"),
                )
                setattr(issue, "latest_update", latest_update)

            issues = res.WorkIssuesLatestUpdateResponseSchema(many=True).dump(
                issue_per_work
            )
            dates = [parser.isoparse(issue["latest_update"]["posted_date"]) for issue in issues]
            status_date_updated = result_item.get("status_date_updated")
            if status_date_updated:
                dates.append(status_date_updated)
            if len(dates):
                result_item["oldest_update"] = min(dates)
            else:
                result_item["oldest_update"] = None

            result_item["work_issues"] = issues
            # Update all works with the work issues
            for work in group["items"][1:]:
                work["work_issues"] = result_item["work_issues"]
                work["oldest_update"] = result_item["oldest_update"]
        return data

    def generate_report(
        self, report_date: datetime, return_type
    ):  # pylint: disable=too-many-locals
        """Generates a report and returns it"""
        self.report_date = report_date.astimezone(utc)
        data = self._fetch_data(report_date + timedelta(days=-3))
        data = self._format_data(data)
        data = self._update_staleness(data, report_date)
        if return_type == "json" or not data:
            return process_data(data, return_type)
        pdf_stream = BytesIO()
        current_directory = path.dirname(path.abspath(__file__))  # TODO CJK: refactor to pull out style setup
        font_path = path.join(current_directory, "report_templates", "2023_01_01_BCSans-Regular_2f.ttf")
        bold_font_path = path.join(current_directory, "report_templates", "2023_01_01_BCSans-Bold_2f.ttf")
        pdfmetrics.registerFont(TTFont('BCSans', font_path))
        pdfmetrics.registerFont(TTFont('BCSans-Bold', bold_font_path))
        stylesheet = getSampleStyleSheet()
        doc = BaseDocTemplate(pdf_stream, pagesize=A4)
        doc.page_width = doc.width + doc.leftMargin * 2
        doc.page_height = doc.height + doc.bottomMargin * 2
        page_table_frame = Frame(
            doc.leftMargin,
            doc.bottomMargin,
            doc.width,
            doc.height,
            id="large_table",
        )
        page_template = PageTemplate(
            id="LaterPages", frames=[page_table_frame], onPage=self.add_default_info
        )
        doc.addPageTemplates(page_template)
        title_style = stylesheet["Heading2"]
        title_style.fontName = 'BCSans'
        title_style.alignment = TA_CENTER
        heading_style = stylesheet["Heading3"]
        heading_style.fontName = 'BCSans'
        heading_style.alignment = TA_CENTER
        story = [NextPageTemplate(["*", "LaterPages"])]
        story.append(Paragraph("30-60-90", title_style))
        story.append(Paragraph("Environmental Assessment Office", heading_style))
        story.append(
            Paragraph(f"Submitted for: {report_date:%B %d, %Y}", heading_style)
        )
        normal_style = stylesheet["Normal"]
        normal_style.fontSize = 6.5
        normal_style.fontName = 'BCSans'
        subheading_style = ParagraphStyle(
            "subheadings",
            parent=normal_style,
            fontName="BCSans-Bold",
            fontSize=9
        )
        table_data = [[Paragraph("Issue", subheading_style), Paragraph("Status/Key Milestones/Next Steps", subheading_style)]]

        data, styles = self._get_table_data_and_styles(data, normal_style, subheading_style)
        table_data.extend(data)
        max_column_width = 4 * inch
        table = Table(table_data, colWidths=[None, max_column_width])
        table.setStyle(
            TableStyle(
                [
                    ("BOX", (0, 0), (-1, -1), 0.25, colors.black),
                    ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.black),
                    ("FONTSIZE", (0, 0), (-1, -1), 6.5),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("ALIGN", (0, 0), (-1, -1), "LEFT"),
                    ("FONTNAME", (0, 2), (-1, -1), "BCSans"),
                    ("FONTNAME", (0, 0), (-1, 1), "BCSans-Bold"),
                    ("WORDWRAP", (0, 0), (-1, -1)),
                ]
                + styles
            )
        )
        story.append(table)
        doc.build(story)
        pdf_stream.seek(0)
        return pdf_stream.getvalue(), f"{self.report_title}_{report_date:%Y_%m_%d}.pdf"

    def add_default_info(self, canvas, doc):
        """Adds default information for each page."""
        canvas.saveState()
        last_updated = self.report_date + timedelta(days=-1)
        canvas.drawString(doc.leftMargin, doc.bottomMargin, "Draft and Confidential")
        canvas.drawRightString(
            doc.page_width - doc.rightMargin,
            doc.bottomMargin,
            f"Last updated: {last_updated:%B %d, %Y}",
        )
        canvas.restoreState()

    def _get_next_pcp_query(self, start_date, end_date):
        """Create and return the subquery for next PCP event based on start and end dates"""
        next_pcp_min_date_query = (
            db.session.query(
                Event.work_id,
                func.min(
                    func.coalesce(Event.actual_date, Event.anticipated_date)
                ).label("min_pcp_date"),
            )
            .filter(
                func.coalesce(Event.actual_date, Event.anticipated_date).between(
                    start_date.date(), end_date.date()
                ),
                Event.event_configuration_id.in_(self.pecp_configuration_ids),
            )
            .group_by(Event.work_id)
            .subquery()
        )

        next_pecp_query = (
            db.session.query(
                Event,
            )
            .join(
                next_pcp_min_date_query,
                and_(
                    next_pcp_min_date_query.c.work_id == Event.work_id,
                    func.coalesce(Event.actual_date, Event.anticipated_date)
                    == next_pcp_min_date_query.c.min_pcp_date,
                ),
            )
            .filter(
                Event.event_configuration_id.in_(self.pecp_configuration_ids),
            )
            .subquery()
        )
        return next_pecp_query

    def _get_valid_work_issue_work_ids(self, report_date):
        """Find and return set of valid work ids that have a high priority work issue"""
        start_date = report_date + timedelta(days=-29)
        end_date = report_date + timedelta(days=119)
        work_ids = (
            db.session.query(WorkIssues.work_id)
            .join(WorkIssueUpdates.work_issue)
            .filter(
                WorkIssueUpdates.is_approved.is_(True),
                WorkIssueUpdates.posted_date.between(start_date.date(), end_date.date()),
                WorkIssues.work_id.in_(self.high_profile_work_issue_work_ids)
            )
        )
        return work_ids

    def _get_valid_event_ids(self, report_date):
        """Find and return set of valid decision or high priority event ids"""
        start_date = report_date + timedelta(days=-3)
        end_date = report_date + timedelta(days=93)
        # Subquery to get referral events that have an anticipated date, but no actual (eg. Referral has not yet been made)
        referral_exists_subquery = (
            db.session.query(Event.id)
            .filter(
                Event.work_id == Work.id,
                Event.event_configuration.has(event_type_id=EventTypeEnum.REFERRAL.value),
                # Event.anticipated_date.isnot(None),
                Event.actual_date.is_(None)
            )
            .correlate(Work)
            .exists()
        )
        valid_events = (
            db.session.query(Event.id)
            .join(EventConfiguration, Event.event_configuration)
            .join(Work, Event.work)
            .filter(
                or_(
                    and_(
                        # Keep Minister's decision with no actual date if anticipated date indicates it should have been made
                        EventConfiguration.event_type_id == EventTypeEnum.MINISTER_DECISION.value,
                        Event.actual_date.is_(None),
                        Event.anticipated_date < start_date.date()
                    ),
                    and_(
                        # Keep decisions with no actual date if date has passed and referral was already made
                        EventConfiguration.event_type_id == EventCategoryEnum.DECISION.value,
                        Event.actual_date.is_(None),
                        Event.anticipated_date.between(
                            (report_date + timedelta(days=-1600)).date(),
                            end_date.date()
                        ),
                        ~referral_exists_subquery,  # Exclude decisions if an anticipated referral exists
                    ),
                    and_(
                        func.coalesce(Event.actual_date, Event.anticipated_date).between(
                            start_date.date(), end_date.date()
                        ),
                        or_(
                            Event.event_configuration_id.in_(self.decision_configuration_ids), # Decision events
                            and_( # High profile work with pcp
                                Work.is_high_priority.is_(True),
                                EventConfiguration.event_category_id == EventCategoryEnum.PCP.value,
                                EventConfiguration.event_type_id == EventTypeEnum.COMMENT_PERIOD.value
                            ),
                            and_( # High profile events
                                Work.is_high_priority.is_(True),
                                Event.high_priority.is_(True),
                                EventConfiguration.event_category_id.not_in([EventCategoryEnum.CALENDAR.value, EventCategoryEnum.FINANCE.value])
                            ),
                            and_(
                                Work.work_type_id == 1, # Project Notification
                                EventConfiguration.event_category_id == EventCategoryEnum.MILESTONE.value,
                                EventConfiguration.event_type_id == EventTypeEnum.REFERRAL.value,
                                EventConfiguration.name == "Project Notification Report referred to Decision Maker",
                            ),
                            and_(
                                Work.work_type_id == 2, # Minister's Designation
                                EventConfiguration.event_category_id == EventCategoryEnum.MILESTONE.value,
                                EventConfiguration.event_type_id == EventTypeEnum.REFERRAL.value,
                                EventConfiguration.name != "Minister's Designation Report referred to Decision Maker",
                            ),
                            and_(
                                Work.work_type_id == 5, # Exemption Order
                                EventConfiguration.event_category_id == EventCategoryEnum.MILESTONE.value,
                                EventConfiguration.event_type_id == EventTypeEnum.REFERRAL.value,
                                EventConfiguration.name != "Exemption Request Package Referred to Minister",
                            ),
                            and_(
                                Work.work_type_id == 6, # Assessment
                                EventConfiguration.event_category_id == EventCategoryEnum.MILESTONE.value,
                                EventConfiguration.event_type_id == EventTypeEnum.REFERRAL.value,
                                EventConfiguration.name.in_(["EAC Referral Package sent to Ministers", "Termination Package Referred to Minister"])
                            ),
                            and_(
                                Work.work_type_id == 7, # Ammendment
                                EventConfiguration.event_category_id == EventCategoryEnum.MILESTONE.value,
                                EventConfiguration.event_type_id == EventTypeEnum.REFERRAL.value,
                                EventConfiguration.name == "Amendment Decision Package Referred to Decision Maker"
                            ),
                        ),
                    )
                )
            )
        )
        return valid_events

    def _format_table_data_events(self, events, style):
        """Generates styled paragraphs for all events relating to the same work"""
        data = []
        tabbed_style = copy.deepcopy(style)
        tabbed_style.leftIndent = 8
        # List events in chronological order
        sorted_events = sorted(events, key=lambda event: event.get("event_date"))
        for event in sorted_events:
            event_description = ""
            event_description_label = ""
            if event["event_type"] == "decision_referral" and event.get("decision_information"):
                event_description = event["decision_information"]
                event_description_label = "Decision Information"
            elif event["event_type"] == "pcp" and event.get("pecp_explanation"):
                event_description = event["pecp_explanation"]
                event_description_label = "PCP Explanation"
            elif event["event_type"] == "work_issue":
                event_description = event["event_description"]
                event_description_label = "Issue Description"
            elif event.get("event_description"):
                event_description = event["event_description"]
                event_description_label = "Event Description"
            # Add paragraphs for each event
            data.append([
                Paragraph(
                    f"{event.get('event_date', 'Unknown Date'): %B %d, %Y} - {event.get('event_title', 'Unknown Title')}",
                    style,
                ),
                Paragraph(
                    f"{event_description_label}: {event_description}" if event_description else "",
                    tabbed_style,
                ),
            ])
        return data

    def _get_event_date_source(self, data):
        """Return the date source"""
        date_sources = {
            "decision_referral": "Decision",
            "work_issue": "Issue",
            "pcp": "Comment Period",
            "other": "Milestone",
        }
        if data["event_type_id"] == EventTypeEnum.REFERRAL.value:
            return "Referral"
        return date_sources[data["event_type"]]

    def _format_table_data(self, period_data, row_index, style):
        """Generates styled table rows for the given period data"""
        # Define a bold style for labels
        style_bold = ParagraphStyle(
            "Bold-Labels",
            parent=style,
            fontName="BCSans-Bold",
        )
        data = []
        for group in period_data:
            events = group["items"]
            events_data = self._format_table_data_events(events, style)
            work = events[0]
            date_source_label = self._get_event_date_source(work) + " Date"
            data.append(
                [
                    [
                        Paragraph(
                            f"{work['project_name']} - {work['work_report_title']}",
                            style_bold,
                        ),
                        Paragraph(
                            f"{date_source_label}: {work['event_date']: %B %d, %Y}",
                            style,
                        ),
                    ],
                    [
                        Paragraph(
                            ("Description"), style_bold
                        ),
                        Paragraph(
                            (
                                work['work_short_description']
                                if work["work_short_description"]
                                else ""
                            ),
                            style,
                        ),
                        Paragraph(
                            ("Status"), style_bold
                        ),
                        Paragraph(
                            (
                                work['work_status_text']
                                if work["work_status_text"]
                                else ""
                            ),
                            style,
                        ),
                        Paragraph(
                            ("Key Milestones"), style_bold
                        ),
                        events_data
                    ],
                ]
            )
            row_index += 1
        return data, row_index

    def _get_table_data_and_styles(self, data, normal_style, subheading_style):
        """Create and return table data and styles"""
        table_data = []
        styles = []
        row_index = 1
        for period, groups in data.items():
            table_data.append([Paragraph(f"{period} days", subheading_style)])
            styles.append(
                (
                    "SPAN",
                    (0, row_index),
                    (-1, row_index),
                )
            )
            styles.append(("ALIGN", (0, row_index), (-1, row_index), "LEFT"))
            styles.append(
                ("FONTNAME", (0, row_index), (-1, row_index), "BCSans-Bold"),
            )
            row_index += 1
            period_data, row_index = self._format_table_data(
                groups, row_index, normal_style
            )
            table_data.extend(period_data)
        return table_data, styles

    def _get_project_special_history_id(
        self, project_id: int, data: List[dict], date: datetime
    ) -> str:
        """Get the special field history value for project name for given period and date"""
        special_history = next(
            (
                sp_hist
                for sp_hist in data
                if sp_hist.entity_id == project_id and sp_hist.time_range.lower <= date
                and (sp_hist.time_range.upper is None or sp_hist.time_range.upper > date)
            ),
            None,
        )
        return special_history

    def _get_project_ids_by_period(self, data: List[dict]) -> Dict[int, List[int]]:
        """Finds project ids by that fall under 30/60/90 days from report date."""
        periods = {30: [], 60: [], 90: []}
        for index, period in enumerate(periods):
            periods[period] = [
                x.get("project_id")
                for x in data
                if x.get("anticipated_decision_date") is not None
                and x.get("anticipated_decision_date") <= self.report_date + timedelta(days=period)
                and x.get("anticipated_decision_date") >= self.report_date + timedelta(days=index * 30)
            ]
        return periods

    def _get_project_special_history(self, data: List[dict]) -> Dict[int, List]:
        """Find special field entry for given project ids valid for 30/60/90 days from report date."""
        project_ids_by_period = self._get_project_ids_by_period(data)
        periods = {30: [], 60: [], 90: []}
        for index, period in enumerate(periods):
            periods[period] = SpecialFieldService.find_special_history_by_date_range(
                entity=EntityEnum.PROJECT.value,
                field_name="name",
                from_date=self.report_date + timedelta(days=index * 30),
                to_date=self.report_date + timedelta(days=period),
                entity_ids=project_ids_by_period[period],
            )
        return periods

    def _categorize_event(self, event: dict) -> str:
        if event.get("event_configuration_id") in self.decision_configuration_ids or event.get("event_type_id") == EventTypeEnum.REFERRAL.value:
            return "decision_referral"
        if event.get("event_configuration_id") in self.pecp_configuration_ids:
            return "pcp"
        if event.get("event_configuraiton_id", None):
            return "other"
        return "work_issue"

    def _handle_work_issue_items(self, resolved_events: list, event: dict, work_id: int):
        """Add separate item for each work_issue in event"""
        work_issues = event.get("work_issues", [])
        if not work_issues or work_id not in self.high_profile_work_issue_work_ids:
            return
        start_date = self.report_date + timedelta(days=-29)
        end_date = self.report_date + timedelta(days=119)

        for work_issue in work_issues:
            latest_update = work_issue.get("latest_update", {})
            posted_date = datetime.fromisoformat(latest_update.get("posted_date")) if latest_update.get("posted_date") else None
            if (
                not work_issue.get("is_resolved", True)
                and work_issue.get("is_active", False)
                and work_issue.get("is_high_priority", False)
                and (start_date <= posted_date <= end_date)
            ):
                # Add this work issue separately
                work_issue_event = copy.deepcopy(event)
                work_issue_event["event_type"] = "work_issue"
                work_issue_event["event_id"] = None
                work_issue_event["event_configuration_id"] = None
                work_issue_event["event_date"] = posted_date
                work_issue_event["event_title"] = work_issue.get("title")
                work_issue_event["event_description"] = latest_update.get("description", "") if latest_update else ""
                resolved_events.append(work_issue_event)

    def _resolve_multiple_events(self, data: List[Dict]) -> List[Dict]:
        """
        Resolves duplicates and orders multiple events for each work.

        Processes a list of event groups, where each group contains a work_id (`group`) and
        associated events (`items`). Events are categorized and ordered and only one decision or referral is kept
        Events are sorted within each work_id group by type and anticipated date.
        """
        resolved_data = []
        for group in data:
            work_id = group['group']
            events = group['items']
            resolved_events = []
            work_issues_handled = False
            decision_referral_event = None
            for event in events:
                event_type = self._categorize_event(event)
                event["event_type"] = event_type
                # if work has both a high profile issue and event on the same report
                if event_type != "work_issue" and not work_issues_handled:
                    # Add issues as separate items in the same work
                    self._handle_work_issue_items(resolved_events, event, work_id)
                    work_issues_handled = True
                if event_type == "decision_referral":
                    if not decision_referral_event or (
                        event.get("event_type_id") == EventTypeEnum.REFERRAL.value
                        and event.get("actual_date") is None
                    ):
                        decision_referral_event = event
                    continue
                if event_type == "work_issue" and not work_issues_handled:
                    self._handle_work_issue_items(resolved_events, event, work_id)
                    work_issues_handled = True
                    continue
                resolved_events.append(event)

            if decision_referral_event:
                resolved_events.append(decision_referral_event)

            if not resolved_events:
                continue
            # Sort the events for each work
            sorted_events = sorted(
                resolved_events,
                key=lambda x: (
                    self.event_order.get(x['event_type']),
                    x.get('event_date', datetime.max)
                )
            )
            resolved_data.append({
                'group': work_id,
                'items': sorted_events
            })
        return resolved_data

    def _format_notes(self, data: List[Dict]) -> List[Dict]:
        for group in data:
            events = group['items']
            for event in events:
                event_notes = event.get("decision_information", "")
                if event_notes:
                    event["decision_information"] = draftjs_extractor(event_notes)
        return data

    def _update_staleness(self, data: dict, report_date: datetime) -> dict:
        """Calculate the staleness based on report date"""
        date = report_date.astimezone(CANADA_TIMEZONE)
        for _, work_type_data in data.items():
            for group in work_type_data:
                first_event = group["items"][0]
                if first_event["status_date_updated"]:
                    diff = (date - first_event["status_date_updated"]).days
                    if diff > 10:
                        first_event["status_staleness"] = StalenessEnum.CRITICAL.value
                    elif diff > 5:
                        first_event["status_staleness"] = StalenessEnum.WARN.value
                    else:
                        first_event["status_staleness"] = StalenessEnum.GOOD.value
                else:
                    first_event["status_staleness"] = StalenessEnum.CRITICAL.value
        return data
