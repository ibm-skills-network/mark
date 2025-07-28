import { Octokit } from "@octokit/rest";
import { toast } from "sonner";

/**
 * Opens a file in a new tab after retrieving its content from GitHub.
 * @param fileUrl The raw GitHub URL of the file.
 * @param octokit An instance of the Octokit client.
 */
export const openFileInNewTab = async (fileUrl: string, octokit: Octokit) => {
  if (!octokit) {
    toast.error("GitHub authentication is missing.");
    return;
  }

  const baseUrl = "https://raw.githubusercontent.com/";
  if (!fileUrl.startsWith(baseUrl)) {
    toast.error("Invalid GitHub raw file URL.");
    return;
  }
  const cleanUrl = fileUrl.split("?")[0];
  const parts = cleanUrl.replace(baseUrl, "").split("/");
  const [owner, repo, branch, ...filePathParts] = parts;
  const path = filePathParts.join("/");

  if (!owner || !repo || !path) {
    toast.error("Invalid file URL - unable to parse owner/repo/path.");
    return;
  }

  try {
    const response = await octokit.repos.getContent({
      owner,
      repo,
      path,
      ref: branch,
    });

    if (response.data && "content" in response.data) {
      const fileContent = response.data.content;
      if (fileContent) {
        const decodedContent = atob(fileContent);
        const blob = new Blob([decodedContent], { type: "text/plain" });
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, "_blank");
      } else {
        toast.error("File content is empty.");
      }
    } else {
      toast.error("Failed to retrieve file content.");
    }
  } catch (error) {
    toast.error(
      "Could not open the file. Check that the file exists and that you have the necessary permissions.",
    );
  }
};
``;
