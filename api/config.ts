import { hostedConfig } from '../src/hosted/handler.js';

export function GET() {
  return Response.json(hostedConfig(), { headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}
