import GroupVotingRoom from "@/ui/group-voting-room";

export default async function GroupRoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<{ manage?: string; invite?: string }>;
}) {
  const [{ roomId }, { manage, invite }] = await Promise.all([params, searchParams]);
  return <GroupVotingRoom roomId={roomId} organizerToken={manage?.slice(0, 200)} inviteId={invite?.slice(0, 240)} />;
}
