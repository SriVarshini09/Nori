import { redirect } from "next/navigation";

/** The tracker board became part of Applications (stage filters, follow-ups, ghosted). Old links still work. */
export default function TrackerPage() {
  redirect("/applications");
}
