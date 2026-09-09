import { listApplications, postApplication } from "@/backend/api/applications";

export const runtime = "nodejs";

export function GET(request: Request) {
  return listApplications(request);
}

export function POST(request: Request) {
  return postApplication(request);
}
