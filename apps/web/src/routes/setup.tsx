import { createFileRoute } from "@tanstack/react-router";

import { FenixSetupPage } from "~/components/fenix/FenixSetupPage";

export const Route = createFileRoute("/setup")({
  component: FenixSetupPage,
  head: () => ({
    meta: [
      { name: "title", content: "Instalar Fenix Code" },
      {
        name: "description",
        content: "Instala y empareja de forma privada tu equipo local con Fenix Code.",
      },
    ],
  }),
});
