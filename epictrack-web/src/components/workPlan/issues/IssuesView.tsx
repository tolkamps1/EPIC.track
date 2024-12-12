import React from "react";
import AddIcon from "@mui/icons-material/Add";
import NoDataEver from "../../shared/NoDataEver";
import { IssuesContext } from "./IssuesContext";
import IssuesViewSkeleton from "./IssuesViewSkeleton";
import { Else, If, Then } from "react-if";
import IssueAccordion from "./IssueAccordion";
import { Button, Grid } from "@mui/material";
import { WorkplanContext } from "../WorkPlanContext";
import { WorkIssue } from "../../../models/Issue";
import IssueDialogs from "./Dialogs";
import { Restricted, hasPermission } from "components/shared/restricted";
import { useAppSelector } from "hooks";
import { ROLES } from "constants/application-constant";

const IssuesView = () => {
  const { issues, team } = React.useContext(WorkplanContext) as {
    issues: WorkIssue[];
    team: { staff: { email: string } }[];
  };

  const { isIssuesLoading, setCreateIssueFormIsOpen } =
    React.useContext(IssuesContext);

  const { roles, email } = useAppSelector((state) => state.user.userDetail);
  const canCreate = hasPermission({ roles, allowed: [ROLES.CREATE] });
  const isTeamMember = team?.some((member) => member.staff.email === email);

  const lastInteractedIssue = React.useRef<number | null>(null);

  // Sorting function
  const sortIssues = (issues: WorkIssue[]): WorkIssue[] => {
    return [...issues].sort((a, b) => {
      // First, sort by resolved status
      if (a.is_resolved !== b.is_resolved) {
        return a.is_resolved ? 1 : -1; // Unresolved items come first
      }
      // Then, sort by date
      if (a.start_date > b.start_date) {
        return -1;
      }
      if (a.start_date < b.start_date) {
        return 1;
      }
      return 0; //Equal
    });
  };

  // Mapping function
  const mapIssues = (
    issues: WorkIssue[],
    lastInteractedIssue: React.MutableRefObject<number | null>
  ) => {
    return issues.map((issue, index) => (
      <Grid key={`accordion-${issue.id}`} item xs={12}>
        <IssueAccordion
          issue={issue}
          defaultOpen={
            lastInteractedIssue.current
              ? issue.id === lastInteractedIssue.current
              : index === 0
          }
          onInteraction={() => {
            lastInteractedIssue.current = issue.id;
          }}
        />
      </Grid>
    ));
  };

  const sortedIssues = sortIssues(issues);

  if (isIssuesLoading) {
    return <IssuesViewSkeleton />;
  }

  return (
    <>
      <If condition={issues.length === 0}>
        <Then>
          <NoDataEver
            title="You don't have any Issues yet"
            subTitle="Start adding your Issues"
            addNewButtonText="Add Issue"
            onAddNewClickHandler={() => setCreateIssueFormIsOpen(true)}
            addButtonProps={{
              disabled: !canCreate && !isTeamMember,
            }}
          />
        </Then>
        <Else>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Restricted
                allowed={[ROLES.CREATE]}
                exception={isTeamMember}
                errorProps={{ disabled: true }}
              >
                <Button
                  variant="contained"
                  onClick={() => setCreateIssueFormIsOpen(true)}
                  startIcon={<AddIcon />}
                >
                  Issue
                </Button>
              </Restricted>
            </Grid>
            {mapIssues(sortedIssues, lastInteractedIssue)}
          </Grid>
        </Else>
      </If>
      <IssueDialogs />
    </>
  );
};

export default IssuesView;
