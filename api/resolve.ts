import { handleTestAction } from '../src/hosted/handler.js';
export function POST(request: Request) { return handleTestAction(request, 'resolve'); }
