import {
  ColorPickerField,
  Form,
  TextField,
} from "@amplication/ui/design-system";
import { Formik } from "formik";
import { omit } from "lodash";
import { useMemo } from "react";
import { DisplayNameField } from "../Components/DisplayNameField";
import * as models from "../models";
import {
  validate,
  validationErrorMessages,
} from "../util/formikValidateJsonSchema";

import FormikAutoSave from "../util/formikAutoSave";

type Props = {
  onSubmit: (values: models.Team) => void;
  defaultValues?: models.Team;
};

const NON_INPUT_GRAPHQL_PROPERTIES = [
  "id",
  "createdAt",
  "updatedAt",
  "__typename",
  "members",
];

export const INITIAL_VALUES: Partial<models.Team> = {
  name: "",
  description: "",
};

const { AT_LEAST_TWO_CHARACTERS } = validationErrorMessages;

const FORM_SCHEMA = {
  required: ["name"],
  properties: {
    name: {
      type: "string",
      minLength: 2,
    },
  },
  errorMessage: {
    properties: {
      name: AT_LEAST_TWO_CHARACTERS,
    },
  },
};

const TeamForm = ({ onSubmit, defaultValues }: Props) => {
  const initialValues = useMemo(() => {
    const sanitizedDefaultValues = omit(
      defaultValues,
      NON_INPUT_GRAPHQL_PROPERTIES
    );
    return {
      ...INITIAL_VALUES,
      ...sanitizedDefaultValues,
    } as models.Team;
  }, [defaultValues]);

  return (
    <>
      <Formik
        initialValues={initialValues}
        validate={(values: models.Team) => validate(values, FORM_SCHEMA)}
        enableReinitialize
        onSubmit={onSubmit}
      >
        <Form childrenAsBlocks>
          <FormikAutoSave debounceMS={1000} />

          <DisplayNameField name="name" label="Name" minLength={1} />

          <TextField name="description" label="Description" textarea rows={3} />
        </Form>
      </Formik>
      <Formik
        initialValues={initialValues}
        validate={(values: models.Team) => validate(values, FORM_SCHEMA)}
        enableReinitialize
        onSubmit={onSubmit}
      >
        <Form childrenAsBlocks>
          <FormikAutoSave debounceMS={0} />

          <ColorPickerField name="color" label="Color" />
        </Form>
      </Formik>
    </>
  );
};

export default TeamForm;