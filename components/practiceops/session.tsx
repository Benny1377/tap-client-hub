"use client";

import { createContext, useContext } from "react";

/** Who is signed in, as the layout resolved it from /api/me. */
export interface PracticeOpsSession {
  role: string;
  allowedModules: string[];
  userName: string;
  userEmail: string;
}

export const SessionContext = createContext<PracticeOpsSession>({
  role: "staff",
  allowedModules: [],
  userName: "",
  userEmail: "",
});

export function useSession() {
  return useContext(SessionContext);
}
