import { handleInspection } from '../src/hosted/handler.js';

export async function POST(request: Request) { return handleInspection(request); }
