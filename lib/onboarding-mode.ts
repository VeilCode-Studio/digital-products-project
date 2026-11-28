/** Staging is reviewed before a separate production opt-in can open independent accounts. */
export function onboardingEnabled(vars: Record<string, string | undefined> = process.env) {
  return vars.WORKSPACE_ONBOARDING_ENABLED === "true" && ["development", "preview", "production"].includes(vars.DEPLOYMENT_ENV ?? "") &&
    (vars.DEPLOYMENT_ENV !== "production" || vars.WORKSPACE_ONBOARDING_PRODUCTION_ENABLED === "true");
}
