"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createProductionProfileService } from "./production-profile-service";
import type { ProfileActionState } from "./profile-action-state";
import { safeProfileNextPath } from "./profile-navigation";

function profileDraftFrom(formData: FormData) {
  return {
    displayName: String(formData.get("displayName") ?? ""),
    major: String(formData.get("major") ?? ""),
    gradYear: String(formData.get("gradYear") ?? ""),
  };
}

async function saveProfile(formData: FormData): Promise<ProfileActionState> {
  let result;
  try {
    const service = await createProductionProfileService();
    result = await service.saveProfile(profileDraftFrom(formData));
  } catch {
    return {
      status: "temporarily_unavailable",
      message: "资料暂时无法保存，请稍后重试。",
    };
  }

  switch (result.status) {
    case "saved":
      return { status: "saved", message: "资料已保存。" };
    case "invalid":
      return {
        status: "invalid",
        message: "请检查填写的信息。",
        fieldErrors: result.fieldErrors,
      };
    case "unauthenticated":
      return {
        status: "unauthenticated",
        message: "登录状态已失效，请重新登录。",
      };
    case "temporarily_unavailable":
      return {
        status: "temporarily_unavailable",
        message: "资料暂时无法保存，请稍后重试。",
      };
  }
}

export async function updateProfileAction(
  _previousState: ProfileActionState,
  formData: FormData,
) {
  const state = await saveProfile(formData);
  if (state.status === "saved") revalidatePath("/profile");
  return state;
}

export async function completeProfileOnboardingAction(
  _previousState: ProfileActionState,
  formData: FormData,
) {
  const state = await saveProfile(formData);
  if (state.status !== "saved") return state;

  revalidatePath("/", "layout");
  redirect(safeProfileNextPath(formData.get("next")));
}
