import { Suspense } from "react";
import { OwnerInviteAccept } from "../../../components/owner-invite-accept";

export default function InviteAcceptPage() {
  return (
    <Suspense fallback={<p className="py-8 text-body text-ink">Loading invite…</p>}>
      <OwnerInviteAccept />
    </Suspense>
  );
}
