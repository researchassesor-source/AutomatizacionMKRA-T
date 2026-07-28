import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "La finalización debe confirmarse desde el panel o desde Moodle." },
    { status: 410 },
  );
}
