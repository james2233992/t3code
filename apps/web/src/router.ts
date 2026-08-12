import { createRouter, RouterHistory } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";
import { routerBasePath } from "./buildBasePath";

export function getRouter(history: RouterHistory) {
  return createRouter({
    routeTree,
    history,
    basepath: routerBasePath(import.meta.env.BASE_URL),
    context: {},
  });
}

export type AppRouter = ReturnType<typeof getRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
