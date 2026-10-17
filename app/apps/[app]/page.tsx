"use client";

import { useParams, useRouter } from "next/navigation";
import { Icon } from "@/components/practiceops/icons";
import { APPS, FIRM } from "@/components/practiceops/apps";

/** Apps the design shows but this project has not built yet. No data, no actions. */
export default function ComingSoonApp() {
  const router = useRouter();
  const { app: id } = useParams<{ app: string }>();
  const app = APPS.find(item => !item.built && item.id === id);

  return (
    <main className="work narrow">
      <div className="phead">
        <div><h2>{app ? app.name : "App not found"}</h2><p className="psub">{app ? app.desc : "There is no app at this address."}</p></div>
      </div>
      <div className="bare">
        {app && <span className="t-ico" style={{ margin: "0 auto 13px" }}><Icon name={app.icon} style={{ display: "grid" }} /></span>}
        <h3 style={{ fontSize: 19, marginBottom: 6 }}>{app ? "Not set up yet" : "Nothing here"}</h3>
        <p style={{ maxWidth: "52ch", margin: "0 auto 16px", lineHeight: 1.6 }}>
          {app
            ? `${app.name} is part of the PracticeOps plan but isn't set up for ${FIRM.name} yet. Nothing on this page reads or changes your data.`
            : "Head back to the launch pad to pick an app."}
        </p>
        <button className="btn brand" onClick={() => router.push("/")}>Back to the launch pad</button>
      </div>
    </main>
  );
}
