// Vercel Function entry (Node.js runtime, Web-standard handlers). vercel.json rewrites every /api/* path here.
import {handle} from '../lib/core.mjs';

const run = request => handle(request, process.env);
export const GET = run;
export const POST = run;
export const PUT = run;
export const OPTIONS = run;
