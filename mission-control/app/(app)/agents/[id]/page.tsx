import { AgentDetailView } from "@/components/agents/agent-detail-view";

export const dynamic = "force-dynamic";

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AgentDetailView agentId={id} />;
}
