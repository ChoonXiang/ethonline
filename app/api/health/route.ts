import { getControlApiHealth } from "@/backend/api/health";

export const runtime = "nodejs";

export function GET() {
  return Response.json(getControlApiHealth(), {
    headers: { "Cache-Control": "no-store" },
  });
}
