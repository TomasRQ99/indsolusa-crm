import { revalidatePath } from "next/cache";

// Records show up on several screens (dashboard, lists, detail pages), so after a
// mutation we simply refresh everything under the app layout.
export function refreshApp() {
  revalidatePath("/", "layout");
}
