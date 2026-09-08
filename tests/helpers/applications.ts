export const registration = {
  displayName: "Demo API",
  serviceName: "api.example.eth",
  primaryEndpoint: "https://primary.example",
  imageDigest: `registry.example/demo@sha256:${"a".repeat(64)}`,
  expectedVersion: "1.0.0",
  policyRef: "policies/demo",
  policyVersion: "policy-v1",
  credentialRef: "cre:demo-preflight",
};

export const allowedOrigins = ["https://primary.example"];
