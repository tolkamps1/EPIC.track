import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Divider, Grid, InputAdornment, Tooltip } from "@mui/material";
import { FormProvider, useForm } from "react-hook-form";
import * as yup from "yup";
import { yupResolver } from "@hookform/resolvers/yup";
import Moment from "moment";
import dayjs from "dayjs";
import { ListType } from "../../../models/code";
import { Ministry } from "../../../models/ministry";
import { POSITION_ENUM } from "../../../models/position";
import { Project } from "../../../models/project";
import { Staff } from "../../../models/staff";
import { defaultWork, Work } from "../../../models/work";
import projectService from "../../../services/projectService/projectService";
import staffService from "../../../services/staffService/staffService";
import workService from "../../../services/workService/workService";
import eaActService from "services/eaActService";
import EAOTeamService from "services/eao_team";
import federalInvolvementService from "services/federalInvolvementService";
import ministryService from "services/ministryService";
import substitutionActService from "services/substitutionActService";
import { ETFormLabel, ETFormLabelWithCharacterLimit } from "../../shared";
import ControlledSelectV2 from "../../shared/controlledInputComponents/ControlledSelectV2";
import ControlledSwitch from "../../shared/controlledInputComponents/ControlledSwitch";
import ControlledDatePicker from "../../shared/controlledInputComponents/ControlledDatePicker";
import ControlledTextField from "../../shared/controlledInputComponents/ControlledTextField";
import {
  MIN_WORK_START_DATE,
  ROLES,
  SPECIAL_FIELD_TYPES,
  SPECIAL_FIELDS,
  SpecialFieldEntityEnum,
} from "../../../constants/application-constant";
import { useAppSelector } from "hooks";
import { hasPermission } from "components/shared/restricted";
import { sort } from "../../../utils";
import { IconProps } from "../../icons/type";
import icons from "../../icons";
import { WorkFormSpecialField } from "./WorkFormSpecialField";
import { useIsTeamMember } from "components/workPlan/utils";

const maxTitleLength = 150;
const schema = yup.object<Work>().shape({
  ea_act_id: yup.number().required("EA Act is required"),
  work_type_id: yup.number().required("Work type is required"),
  start_date: yup.date().required("Start date is required"),
  project_id: yup.number().required("Project is required"),
  ministry_id: yup.number().required("2nd Responsible Ministry is required"),
  federal_involvement_id: yup
    .number()
    .required("Federal Involvement is required"),
  report_description: yup.string().required("Work description is required"),
  title: yup
    .string()
    .required("Title is required")
    .max(maxTitleLength, "Title should not exceed 150 characters")
    .test({
      name: "checkDuplicateWork",
      exclusive: true,
      message: "Work with the given title already exists",
      test: async (value, { parent }) => {
        if (value) {
          const validateWorkResult = await workService.checkWorkExists(
            value,
            parent["id"]
          );
          return validateWorkResult.data
            ? (!(validateWorkResult.data as any)["exists"] as boolean)
            : true;
        }
        return true;
      },
    }),
  simple_title: yup.string(),
  substitution_act_id: yup.number().required("Federal Act is required"),
  eao_team_id: yup.number().required("EAO team is required"),
  responsible_epd_id: yup.number().required("Responsible EPD is required"),
  work_lead_id: yup.number().required("Work Lead is required."),
  decision_by_id: yup.number().required("Decision Maker is required"),
});

const InfoIcon: React.FC<IconProps> = icons["InfoIcon"];

type WorkFormProps = {
  work: Work | null;
  fetchWork: () => void;
  saveWork: (data: any) => void;
  setDisableDialogSave?: (disable: boolean) => void;
};

export default function WorkForm({
  work,
  fetchWork,
  saveWork,
  setDisableDialogSave,
}: WorkFormProps) {
  const [eaActs, setEAActs] = useState<ListType[]>([]);
  const [workTypes, setWorkTypes] = useState<ListType[]>([]);
  const [projects, setProjects] = useState<ListType[]>([]);
  const [ministries, setMinistries] = useState<ListType[]>([]);
  const [federalInvolvements, setFederalInvolvements] = useState<ListType[]>(
    []
  );
  const [substitutionActs, setSubstitutionActs] = useState<ListType[]>([]);
  const [teams, setTeams] = useState<ListType[]>([]);
  const [epds, setEPDs] = useState<Staff[]>([]);
  const [leads, setLeads] = useState<Staff[]>([]);
  const [decisionMakers, setDecisionMakers] = useState<Staff[]>([]);
  const [titlePrefix, setTitlePrefix] = useState<string>("");

  const methods = useForm({
    resolver: yupResolver(schema),
    defaultValues: work ?? undefined,
    mode: "onBlur",
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setValue,
    watch,
  } = methods;

  const workTypeId = watch("work_type_id");
  const projectId = watch("project_id");

  const federalInvolvementId = watch("federal_involvement_id");
  const title = watch("title");

  const { roles } = useAppSelector((state) => state.user.userDetail);
  const isTeamMember = useIsTeamMember();
  const canEdit =
    hasPermission({ roles, allowed: [ROLES.EDIT] }) || isTeamMember;

  const [isEpdFieldUnlocked, setIsEpdFieldUnlocked] = useState<boolean>(false);

  const [isWorkLeadFieldUnlocked, setIsWorkLeadFieldUnlocked] =
    useState<boolean>(false);

  const [isMinistryFieldUnlocked, setIsMinistryFieldUnlocked] =
    useState<boolean>(false);

  const [isDecisionMakerFieldUnlocked, setIsDecisionMakerFieldUnlocked] =
    useState<boolean>(false);

  const isSpecialFieldUnlocked =
    isEpdFieldUnlocked ||
    isWorkLeadFieldUnlocked ||
    isMinistryFieldUnlocked ||
    isDecisionMakerFieldUnlocked;
  const workHasBeenCreated = work?.id ? true : false;

  useEffect(() => {
    reset(work ?? defaultWork);
  }, [reset, work]);

  useEffect(() => {
    if (setDisableDialogSave) {
      setDisableDialogSave(isSpecialFieldUnlocked);
    }
  }, [isSpecialFieldUnlocked, setDisableDialogSave]);

  useEffect(() => {
    const noneFederalInvolvement = federalInvolvements.find(
      ({ name }) => name === "None"
    );
    const noneSubstitutionAct = substitutionActs.find(
      ({ name }) => name === "None"
    );

    if (
      noneSubstitutionAct &&
      Number(federalInvolvementId) === noneFederalInvolvement?.id
    ) {
      setValue("substitution_act_id", noneSubstitutionAct?.id);
    }
  }, [federalInvolvementId, setValue, substitutionActs, federalInvolvements]);

  const staffByRoles = useMemo(
    () =>
      new Map<POSITION_ENUM, (staff: Staff[]) => void>([
        [POSITION_ENUM.PROJECT_ASSESSMENT_DIRECTOR, setLeads],
        [
          POSITION_ENUM.EXECUTIVE_PROJECT_DIRECTOR,
          (staff) => {
            setLeads(staff);
            setEPDs(staff);
          },
        ],
        [POSITION_ENUM.ASSOCIATE_DEPUTY_MINISTER, setDecisionMakers],
        [POSITION_ENUM.ADM, setDecisionMakers],
        [POSITION_ENUM.MINISTER, setDecisionMakers],
      ]),
    []
  );

  const getStaffByPosition = useMemo(
    () => async (position: POSITION_ENUM) => {
      const staffResult = await staffService.getStaffByPosition(
        position.toString()
      );
      if (staffResult.status === 200) {
        const data = sort(staffResult.data as never[], "full_name");
        staffByRoles.get(position)?.(data);
      }
    },
    [staffByRoles]
  );

  const getProjects = async () => {
    const projectResult = await projectService.getAll("list_type");
    if (projectResult.status === 200) {
      let projects = projectResult.data as ListType[];
      projects = sort(projects, "name");
      setProjects(projects);
    }
  };

  const getProject = async (id: string) => {
    const projectResult = await projectService.getById(id);
    if (projectResult.status === 200) {
      return projectResult.data as Project;
    }
  };

  const getMinistries = async () => {
    const ministryResult = await ministryService.getAll();
    if (ministryResult.status === 200) {
      setMinistries(ministryResult.data as ListType[]);
    }
  };

  const getEAActs = async () => {
    const eaActResult = await eaActService.getAll();
    if (eaActResult.status === 200) {
      const eaActs = eaActResult.data as ListType[];
      setEAActs(eaActs);
    }
  };

  const getWorkTypes = async () => {
    const workTypeResult = await workService.getWorkTypes();
    if (workTypeResult.status === 200) {
      const workType = workTypeResult.data as ListType[];
      setWorkTypes(workType);
    }
  };

  const getEAOTeams = async () => {
    const eaoTeamsResult = await EAOTeamService.getEaoTeams();
    if (eaoTeamsResult.status === 200) {
      const eaoTeams = eaoTeamsResult.data as ListType[];
      setTeams(eaoTeams);
    }
  };

  const getFederalInvolvements = async () => {
    const federalInvolvementResult = await federalInvolvementService.getAll();
    if (federalInvolvementResult.status === 200) {
      const federalInvolvements = federalInvolvementResult.data as ListType[];
      setFederalInvolvements(federalInvolvements);
    }
  };

  const getSubstitutionActs = async () => {
    const substitutionActResult = await substitutionActService.getAll();
    if (substitutionActResult.status === 200) {
      const substitutionActs = substitutionActResult.data as ListType[];
      setSubstitutionActs(substitutionActs);
    }
  };

  useEffect(() => {
    const fetchStaff = async () => {
      const promises = Object.keys(staffByRoles).map((key) =>
        getStaffByPosition(Number(key) as POSITION_ENUM)
      );
      await Promise.all(promises);
      await Promise.all([
        getEAActs(),
        getEAOTeams(),
        getFederalInvolvements(),
        getMinistries(),
        getProjects(),
        getSubstitutionActs(),
        getWorkTypes(),
      ]);
    };
    fetchStaff();
  }, [getStaffByPosition, staffByRoles]);

  const onSubmitHandler = async (data: any) => {
    data.start_date = Moment(data.start_date).format();
    saveWork(data);
  };

  const simple_title = watch("simple_title");
  const titleSeparator = " - ";
  const getTitlePrefix = useCallback(() => {
    let prefix = "";
    if (projectId) {
      const project = projects.find(
        (project) => project.id === Number(projectId)
      );
      prefix += `${project?.name}${titleSeparator}`;
    }
    if (workTypeId) {
      const workType = workTypes.find((type) => type.id === Number(workTypeId));
      prefix += `${workType?.name}${titleSeparator}`;
    }
    return prefix;
  }, [projectId, workTypeId, projects, workTypes, titleSeparator]);

  useEffect(() => {
    if (projects.length > 0 && workTypes.length > 0) {
      const prefix = getTitlePrefix();
      setTitlePrefix(prefix);
    }
  }, [getTitlePrefix, projects, workTypes]);

  useEffect(() => {
    if (simple_title) {
      setValue("title", `${titlePrefix}${simple_title}`);
    } else {
      // If simple_title is not set, remove the hanging separator
      const trimmedPrefix = titlePrefix.endsWith(titleSeparator)
        ? titlePrefix.slice(0, -titleSeparator.length)
        : titlePrefix;
      setValue("title", trimmedPrefix);
    }
  }, [titlePrefix, simple_title, setValue]);

  const handleProjectChange = async (id: string) => {
    if (id) {
      const selectedProject: any = projects.filter((project) => {
        return project.id.toString() === id;
      });
      const project = await getProject(selectedProject[0].id);
      setValue("epic_description", String(project?.description));
    }
  };

  return (
    <FormProvider {...methods}>
      <Grid
        component={"form"}
        id="work-form"
        container
        spacing={2}
        onSubmit={handleSubmit(onSubmitHandler)}
      >
        <Grid item xs={4}>
          <ETFormLabel required>EA Act</ETFormLabel>
          <ControlledSelectV2
            placeholder="Select EA Act"
            helperText={errors?.ea_act_id?.message?.toString()}
            defaultValue={work?.ea_act_id}
            options={eaActs || []}
            getOptionValue={(o: ListType) => o?.id.toString()}
            getOptionLabel={(o: ListType) => o.name}
            {...register("ea_act_id")}
            disabled={!canEdit || isSpecialFieldUnlocked}
          ></ControlledSelectV2>
        </Grid>
        <Grid item xs={4}>
          <ETFormLabel required>Worktype</ETFormLabel>
          <ControlledSelectV2
            placeholder="Select Worktype"
            helperText={errors?.ea_act_id?.message?.toString()}
            defaultValue={work?.ea_act_id}
            options={workTypes || []}
            getOptionValue={(o: ListType) => o?.id.toString()}
            getOptionLabel={(o: ListType) => o.name}
            {...register("work_type_id")}
            disabled={!canEdit || workHasBeenCreated}
          ></ControlledSelectV2>
        </Grid>
        <Grid item xs={4}>
          <ETFormLabel className="start-date-label" required>
            Start date
          </ETFormLabel>
          <ControlledDatePicker
            name="start_date"
            disabled={!canEdit || isSpecialFieldUnlocked}
            datePickerProps={{
              minDate: dayjs(MIN_WORK_START_DATE),
            }}
          />
        </Grid>
        <Divider style={{ width: "100%", marginTop: "10px" }} />
        <Grid item xs={6}>
          <ETFormLabel required>Project</ETFormLabel>
          <ControlledSelectV2
            onHandleChange={handleProjectChange}
            placeholder="Select"
            helperText={errors?.project_id?.message?.toString()}
            defaultValue={work?.project_id}
            options={projects || []}
            getOptionValue={(o: ListType) => o?.id?.toString()}
            getOptionLabel={(o: ListType) => o?.name}
            {...register("project_id")}
            disabled={!canEdit || workHasBeenCreated}
          ></ControlledSelectV2>
        </Grid>
        <WorkFormSpecialField
          id={work?.id}
          onLockClick={() => setIsMinistryFieldUnlocked((prev) => !prev)}
          open={isMinistryFieldUnlocked}
          onSave={() => {
            fetchWork();
          }}
          options={ministries || []}
          disabled={
            !canEdit ||
            isEpdFieldUnlocked ||
            isWorkLeadFieldUnlocked ||
            isDecisionMakerFieldUnlocked
          }
          entity={SpecialFieldEntityEnum.WORK}
          fieldName={SPECIAL_FIELDS.WORK.MINISTRY}
          fieldLabel="2nd Responsible Ministry"
          fieldValueType={SPECIAL_FIELD_TYPES.INTEGER}
        >
          <ControlledSelectV2
            placeholder="Select"
            helperText={errors?.ministry_id?.message?.toString()}
            defaultValue={work?.ministry_id}
            options={ministries || []}
            getOptionValue={(o: Ministry) => o?.id.toString()}
            getOptionLabel={(o: Ministry) => o.name}
            {...register("ministry_id")}
            disabled={work?.ministry_id !== undefined}
          />
        </WorkFormSpecialField>
        <Grid item xs={6}>
          <ETFormLabel required>Federal Involvement</ETFormLabel>
          <ControlledSelectV2
            placeholder="Select"
            helperText={errors?.federal_involvement_id?.message?.toString()}
            defaultValue={work?.federal_involvement_id}
            options={federalInvolvements || []}
            getOptionValue={(o: ListType) => o?.id.toString()}
            getOptionLabel={(o: ListType) => o.name}
            {...register("federal_involvement_id")}
            disabled={!canEdit || isSpecialFieldUnlocked}
          ></ControlledSelectV2>
        </Grid>

        <Grid item xs={6}>
          <ETFormLabel required>Federal Act</ETFormLabel>
          <ControlledSelectV2
            placeholder="Select"
            helperText={errors?.substitution_act_id?.message?.toString()}
            defaultValue={work?.substitution_act_id}
            options={substitutionActs || []}
            getOptionValue={(o: ListType) => o?.id.toString()}
            getOptionLabel={(o: ListType) => o.name}
            {...register("substitution_act_id")}
            disabled={!canEdit || isSpecialFieldUnlocked}
          ></ControlledSelectV2>
        </Grid>
        <Grid item xs={12}>
          <ETFormLabelWithCharacterLimit
            characterCount={title?.length || 0}
            maxCharacterLength={maxTitleLength}
          >
            Title
          </ETFormLabelWithCharacterLimit>
          <ControlledTextField
            name="simple_title"
            fullWidth
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  {titlePrefix ? `${titlePrefix}` : ""}
                </InputAdornment>
              ),
            }}
            maxLength={maxTitleLength - titlePrefix.length}
            disabled={!canEdit || isSpecialFieldUnlocked}
            error={Boolean(errors.title)}
            helperText={errors?.title?.message?.toString()}
          />
        </Grid>
        <Grid item xs={12}>
          <ETFormLabel required>Work Description</ETFormLabel>
          <ControlledTextField
            name="report_description"
            placeholder="Description will be shown on all reports"
            multiline
            fullWidth
            rows={2}
            disabled={!canEdit || isSpecialFieldUnlocked}
          />
        </Grid>
        <Grid item xs={12}>
          <ETFormLabel>Project Description</ETFormLabel>
          <ControlledTextField
            name="epic_description"
            placeholder=""
            fullWidth
            multiline
            rows={4}
            disabled
          />
        </Grid>
        <Grid item xs={12}>
          <ControlledSwitch
            sx={{ paddingLeft: "0px", marginRight: "10px" }}
            defaultChecked={work?.is_cac_recommended}
            name="is_cac_recommended"
            disabled={!canEdit || isSpecialFieldUnlocked}
          />
          <ETFormLabel id="is_cac_recommended">CAC Required</ETFormLabel>
          <Tooltip
            sx={{ paddingLeft: "2px" }}
            title="Select if there is a sufficient community interest in this Work to establish a Community Advisory Commitee (CAC)"
          >
            <Box component={"span"}>
              <InfoIcon />
            </Box>
          </Tooltip>
        </Grid>
        <Grid item xs={6}>
          <ETFormLabel required>EAO Team</ETFormLabel>
          <ControlledSelectV2
            placeholder="Select"
            helperText={errors?.eao_team_id?.message?.toString()}
            defaultValue={work?.eao_team_id}
            options={teams || []}
            getOptionValue={(o: ListType) => o?.id.toString()}
            getOptionLabel={(o: ListType) => o.name}
            {...register("eao_team_id")}
            disabled={!canEdit || isSpecialFieldUnlocked}
          ></ControlledSelectV2>
        </Grid>
        <WorkFormSpecialField
          id={work?.id}
          onLockClick={() => setIsEpdFieldUnlocked((prev) => !prev)}
          open={isEpdFieldUnlocked}
          onSave={() => {
            fetchWork();
          }}
          options={epds || []}
          disabled={
            !canEdit ||
            isWorkLeadFieldUnlocked ||
            isMinistryFieldUnlocked ||
            isDecisionMakerFieldUnlocked
          }
          entity={SpecialFieldEntityEnum.WORK}
          fieldName={SPECIAL_FIELDS.WORK.RESPONSIBLE_EPD}
          fieldLabel="Responsible EPD"
          fieldValueType={SPECIAL_FIELD_TYPES.INTEGER}
        >
          <ControlledSelectV2
            disabled={work?.responsible_epd_id !== undefined}
            placeholder="Select"
            helperText={errors?.responsible_epd_id?.message?.toString()}
            defaultValue={work?.responsible_epd_id}
            options={
              // Ensure responsible_epd is included if it is locked
              work?.responsible_epd_id &&
              !epds.some((epd) => epd.id === work.responsible_epd_id)
                ? [...epds, work.responsible_epd]
                : epds || []
            }
            getOptionValue={(o: Staff) => o?.id.toString()}
            getOptionLabel={(o: Staff) => o.full_name}
            {...register("responsible_epd_id")}
          />
        </WorkFormSpecialField>
        <WorkFormSpecialField
          id={work?.id}
          onLockClick={() => setIsWorkLeadFieldUnlocked((prev) => !prev)}
          open={isWorkLeadFieldUnlocked}
          onSave={() => {
            fetchWork();
          }}
          options={leads || []}
          disabled={
            !canEdit ||
            isEpdFieldUnlocked ||
            isMinistryFieldUnlocked ||
            isDecisionMakerFieldUnlocked
          }
          entity={SpecialFieldEntityEnum.WORK}
          fieldName={SPECIAL_FIELDS.WORK.WORK_LEAD}
          fieldLabel="Work Lead"
          fieldValueType={SPECIAL_FIELD_TYPES.INTEGER}
        >
          <ControlledSelectV2
            disabled={work?.work_lead_id !== undefined}
            placeholder="Select"
            helperText={errors?.work_lead_id?.message?.toString()}
            defaultValue={work?.work_lead_id}
            options={
              // Ensure lead is included if it is locked
              work?.work_lead_id &&
              !leads.some((lead) => lead.id === work.work_lead_id)
                ? [...leads, work.work_lead]
                : leads || []
            }
            getOptionValue={(o: Staff) => o?.id.toString()}
            getOptionLabel={(o: Staff) => o.full_name}
            {...register("work_lead_id")}
          />
        </WorkFormSpecialField>
        <WorkFormSpecialField
          id={work?.id}
          onLockClick={() => setIsDecisionMakerFieldUnlocked((prev) => !prev)}
          open={isDecisionMakerFieldUnlocked}
          onSave={() => {
            fetchWork();
          }}
          options={decisionMakers || []}
          disabled={
            !canEdit ||
            isEpdFieldUnlocked ||
            isWorkLeadFieldUnlocked ||
            isMinistryFieldUnlocked
          }
          entity={SpecialFieldEntityEnum.WORK}
          fieldName={SPECIAL_FIELDS.WORK.DECISION_MAKER}
          fieldLabel="Decision Maker"
          fieldValueType={SPECIAL_FIELD_TYPES.INTEGER}
        >
          <ControlledSelectV2
            disabled={work?.decision_by_id !== undefined}
            placeholder="Select"
            helperText={errors?.decision_by_id?.message?.toString()}
            defaultValue={work?.decision_by_id}
            options={
              // Ensure decision maker is included if it is locked
              work?.decision_by_id &&
              !decisionMakers.some((dm) => dm.id === work.decision_by_id)
                ? [...decisionMakers, work.decision_by]
                : decisionMakers || []
            }
            getOptionValue={(o: Staff) => o?.id.toString()}
            getOptionLabel={(o: Staff) => o.full_name}
            {...register("decision_by_id")}
          />
        </WorkFormSpecialField>
        <Grid item xs={3} sx={{ paddingTop: "30px !important" }}>
          <ControlledSwitch
            sx={{ paddingLeft: "0px", marginRight: "10px" }}
            name="is_active"
            disabled={!canEdit || isSpecialFieldUnlocked}
          />
          <ETFormLabel id="is_active">Active</ETFormLabel>
        </Grid>
        <Grid item xs={4} sx={{ paddingTop: "30px !important" }}>
          <ControlledSwitch
            sx={{ paddingLeft: "0px", marginRight: "10px" }}
            name="is_high_priority"
            disabled={!canEdit || isSpecialFieldUnlocked}
          />
          <ETFormLabel id="is_watched">High Profile</ETFormLabel>
          <Tooltip
            sx={{ paddingLeft: "2px" }}
            title="Work marked High Profile will have extra milestones appear on Reports"
          >
            <Box component={"span"}>
              <InfoIcon />
            </Box>
          </Tooltip>
        </Grid>
      </Grid>
    </FormProvider>
  );
}
