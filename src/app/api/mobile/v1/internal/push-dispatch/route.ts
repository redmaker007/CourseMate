import { createPushDispatchHandler } from "@/features/push/mobile-dispatch";
import { dispatchProductionMobilePush } from "@/features/push/production-mobile-dispatch";

export const runtime = "nodejs";
export const maxDuration = 60;
export const POST = createPushDispatchHandler(() => process.env.MOBILE_PUSH_DISPATCH_SECRET,dispatchProductionMobilePush);
export const GET = POST;
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
