import { isCalendarConfigured, isSheetsConfigured } from "../../../../lib/googleClient";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    calendarConfigured: isCalendarConfigured(),
    sheetsConfigured: isSheetsConfigured(),
  });
}
