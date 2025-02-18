import { MasterContext } from "components/shared/MasterContext";
import { MasterBase } from "models/type";
import ProponentForm from "../ProponentForm";
import { Staff } from "models/staff";
import { defaultProponent } from "models/proponent";
import { AppConfig } from "config";
import { setupIntercepts } from "../../../../cypress/support/utils";

const staffs: Staff[] = [
  {
    id: 1,
    full_name: "John Doe",
    first_name: "", // Add the missing property
    last_name: "", // Add the missing property
    phone: "",
    email: "",
    is_active: false,
    position_id: 2 /* add more missing properties here */,
    position: { name: "test", id: 1, sort_order: 0 }, // Add the missing property
  },
  {
    id: 2,
    full_name: "John Doe",
    first_name: "", // Add the missing property
    last_name: "", // Add the missing property
    phone: "",
    email: "",
    is_active: false,
    position_id: 2 /* add more missing properties here */,
    position: { name: "test", id: 1, sort_order: 1 }, // Add the missing property
  },
  // Add more mock Staff objects as needed
];

const endpoints = [
  {
    name: "getActiveStaffsOptions",
    method: "OPTIONS",
    url: `${AppConfig.apiUrl}staffs?is_active=false`,
  },
  {
    name: "getPIPTypeOptions",
    method: "OPTIONS",
    url: `${AppConfig.apiUrl}codes/pip_org_types`,
  },

  {
    name: "getFirstNationsOptions",
    method: "OPTIONS",
    url: `${AppConfig.apiUrl}first_nations`,
  },
  {
    name: "getActiveStaffs",
    method: "GET",
    url: `${AppConfig.apiUrl}staffs?is_active=false`,
    response: { body: staffs },
  },
  {
    name: "getPIPType",
    method: "GET",
    url: `${AppConfig.apiUrl}pip-org-types`,
    response: { body: [] },
  },
  {
    name: "getFirstNations",
    method: "GET",
    url: `${AppConfig.apiUrl}first_nations`,
    response: { body: [] },
  },
];

function createMockContext() {
  return {
    item: defaultProponent,
    setFormId: cy.stub(),
    setTitle: cy.stub(),
    setId: cy.stub(),
    onSave: cy.stub(),
    title: "",
    data: [] as MasterBase[],
    loading: false,
    setItem: cy.stub(),
    setShowDeleteDialog: cy.stub(),
    setShowModalForm: cy.stub(),
    getData: cy.stub(),
    setService: cy.stub(),
    setForm: cy.stub(),
    onDialogClose: cy.stub(),
    setFormStyle: cy.stub(),
    getById: cy.stub(),
    setDialogProps: cy.stub(),
  };
}

describe("ProponentForm", () => {
  beforeEach(() => {
    const mockContext = createMockContext();
    setupIntercepts(endpoints);
    cy.mount(
      <MasterContext.Provider value={mockContext}>
        <ProponentForm />
      </MasterContext.Provider>
    );
  });

  it("renders the form", () => {
    cy.get("form").should("be.visible");
  });

  it("renders the name field", () => {
    cy.get('input[name="name"]');
  });

  it("renders the relationship holder field", () => {
    cy.get('input[name="relationship_holder_id"]');
  });
});
