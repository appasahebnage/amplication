import { Dialog } from "@amplication/ui/design-system";
import { Snackbar } from "@mui/material";
import React from "react";
import * as models from "../../../models";
import { formatError } from "../../../util/error";
import BlueprintRelationForm from "../../BlueprintRelationForm";
import useBlueprints from "../../hooks/useBlueprints";

type Props = {
  blueprint: models.Blueprint;
  relation: models.BlueprintRelation;
};

const EditRelation = React.memo(({ blueprint, relation }: Props) => {
  const {
    upsertBlueprintRelation,
    upsertBlueprintRelationError,
    upsertBlueprintRelationLoading,
  } = useBlueprints(blueprint?.id);

  const [isOpen, setIsOpen] = React.useState(false);

  const errorMessage = formatError(upsertBlueprintRelationError);

  const handleSubmit = (relation: models.BlueprintRelation) => {
    const variables: models.MutationUpsertBlueprintRelationArgs = {
      data: relation,
      where: {
        blueprint: {
          id: blueprint.id,
        },
        relationKey: relation.key,
      },
    };

    upsertBlueprintRelation({
      variables,
    }).catch(console.error);
  };

  return (
    <>
      <Dialog
        isOpen={isOpen}
        onDismiss={() => setIsOpen(false)}
        title={relation?.name}
      >
        {isOpen && (
          <BlueprintRelationForm
            blueprintRelation={relation}
            onSubmit={handleSubmit}
          />
        )}
      </Dialog>
      <div
        className={`model-node__column_display_name`}
        onClick={() => {
          setIsOpen(true);
        }}
      >
        <span title={relation.description}>{relation.name}</span>
      </div>
      <Snackbar
        open={Boolean(upsertBlueprintRelationError)}
        message={errorMessage}
      />
    </>
  );
});

export default EditRelation;
