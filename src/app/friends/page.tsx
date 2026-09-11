import { renderFriendsPage } from "@/features/friends/friends-page";

export const dynamic = "force-dynamic";

export default function FriendsPage() {
  return renderFriendsPage(false);
}
