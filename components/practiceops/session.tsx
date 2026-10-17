"use client";

import { createContext, useContext } from "react";

/** Who is signed in, as the layout resolved it from /api/me (role reflects "Viewing as"). */
export interface PracticeOpsSession {
  role: string;
  realRole: string;
  allowedModules: string[];
  userName: string;
  userEmail: string;
}

export const SessionContext = createContext<PracticeOpsSession>({
  role: "staff",
  realRole: "staff",
  allowedModules: [],
  userName: "",
  userEmail: "",
});

export function useSession() {
  return useContext(SessionContext);
}
