import { NextResponse } from "next/server";

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function fail(message: string, status = 400, details?: unknown): NextResponse {
  return NextResponse.json(
    {
      error: message,
      details
    },
    { status }
  );
}
