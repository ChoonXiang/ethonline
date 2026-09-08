export interface RegistrationInput {
  displayName: string;
  serviceName: string;
  primaryEndpoint: string;
  imageDigest: string;
  expectedVersion: string;
  policyRef: string;
  policyVersion: string;
  credentialRef: string;
}

export interface Application extends RegistrationInput {
  schemaVersion: 1;
  applicationId: string;
  status: "disarmed";
  armingId: null;
  currentEndpoint: string;
  expectedService: string;
  healthPath: "/healthz";
  functionalPath: "/api/message";
  createdAt: number;
  updatedAt: number;
}

export interface RegistrationResult {
  created: boolean;
  application: Application;
}

export interface ApplicationStore {
  insertIfAbsent(application: Application): RegistrationResult;
  get(applicationId: string): Application | undefined;
  list(): Application[];
}

export class ApplicationError extends Error {
  constructor(
    public readonly code: "invalid_registration" | "service_name_conflict",
    public readonly field?: keyof RegistrationInput | "body",
  ) {
    super(code);
    this.name = "ApplicationError";
  }
}
