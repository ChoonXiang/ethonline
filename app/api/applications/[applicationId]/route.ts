import { getApplication } from "@/backend/api/applications";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ applicationId: string }> }) {
  const { applicationId } = await context.params;
  return getApplication(request, applicationId);
}
