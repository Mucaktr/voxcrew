// Ekip S12 (Ajan profilleri) —
// /ajanlar → ızgara + arama + filtreler; /ajanlar/:slug → tam profil (?tab= ile bölüm); /ajanlar?gorunum=depo → Depo
// (UXF-E: ekibin aldığı hediyeler, ajan başına; GiftDepot yapılmıştı ama hiçbir yere bağlı değildi).
import { useParams, useSearchParams } from "react-router-dom";
import { AgentList } from "../components/agents/AgentList";
import { AgentProfile } from "../components/agents/AgentProfile";
import { EDITION } from "../edition";
import { GiftDepotView } from "../full/ui";

export default function AgentsPage() {
  const { slug } = useParams<{ slug?: string }>();
  const [params] = useSearchParams();
  if (slug) return <AgentProfile slug={slug} />;
  return params.get("gorunum") === "depo" && (EDITION as string) !== "free" ? <GiftDepotView /> : <AgentList />;
}
