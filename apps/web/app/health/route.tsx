import { NextResponse } from "next/server";

export function GET() {
  try {
    return NextResponse.json({
      status: "ok",
    });
  } catch (e) {
    return NextResponse.error();
  }
}
