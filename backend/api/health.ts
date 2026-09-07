import { PROJECT_NAME } from "../config/project";

export function getControlApiHealth() {
  return {
    status: "ok",
    service: `${PROJECT_NAME}-control-api`,
    recoveryReady: false,
  } as const;
}
