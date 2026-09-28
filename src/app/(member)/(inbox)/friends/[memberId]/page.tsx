import { renderFriendDetailPage } from "@/features/friends/friends-page";

export const dynamic = "force-dynamic";

export default async function FriendDetailPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const { memberId } = await params;
  return renderFriendDetailPage(memberId);
}
