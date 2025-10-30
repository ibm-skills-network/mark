"use client";

import { openFileInNewTab } from "@/app/Helpers/openNewTabGithubFile";
import Modal from "@/components/Modal";
import { RepoContentItem, RepoType } from "@/config/types";
import {
  AuthorizeGithubBackend,
  exchangeGithubCodeForToken,
  getStoredGithubToken,
  getUser,
} from "@/lib/talkToBackend";
import { learnerFileResponse } from "@/stores/learner";
import {
  ArrowLeftIcon,
  ArrowTopRightOnSquareIcon,
  DocumentTextIcon,
  FolderIcon,
} from "@heroicons/react/24/outline";
import { Octokit } from "@octokit/rest";
import { IconSearch } from "@tabler/icons-react";
import { AnimatePresence, motion } from "framer-motion";
import { useSearchParams } from "next/navigation";
import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const GithubModal: React.FC<{
  onClose: () => void;
  assignmentId: number;
  questionId: number;
  owner: string | null;
  setOwner: (owner: string | null) => void;
  repos: RepoType[];
  setRepos: (repos: RepoType[]) => void;
  selectedFiles: learnerFileResponse[];
  setSelectedFiles: (files: learnerFileResponse[]) => void;
  repoContents: RepoContentItem[];
  setRepoContents: (contents: RepoContentItem[]) => void;
  currentPath: string[];
  setCurrentPath: (path: string[]) => void;
  addToPath: (path: string) => void;
  selectedRepo: string | null;
  setSelectedRepo: (repo: string | null) => void;
  onFileChange: (files: learnerFileResponse[], questionId: number) => void;
}> = ({
  onClose,
  assignmentId,
  questionId,
  owner,
  setOwner,
  repos,
  setRepos,
  selectedFiles,
  setSelectedFiles,
  repoContents,
  setRepoContents,
  currentPath,
  setCurrentPath,
  selectedRepo,
  setSelectedRepo,
  onFileChange,
}) => {
  const [token, setToken] = useState<string | null>(null);
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(false);
  const [authAttempted, setAuthAttempted] = useState(false);
  const [searchTimer, setSearchTimer] = useState<NodeJS.Timeout | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [loadingSearch, setLoadingSearch] = useState(false);
  const errorShownRef = useRef<boolean>(false);
  const getUserRole = async (): Promise<string | undefined> => {
    const user = await getUser();
    if (user) {
      return user.role;
    }
    return undefined;
  };
  const showErrorOnce = (message: string) => {
    if (!errorShownRef.current) {
      toast.error(message);
      errorShownRef.current = true;
    }
  };

  const authenticateUser = async () => {
    try {
      const localUrl = window.location.href;
      const urlWithoutCode = localUrl.split("?")[0];
      window.history.replaceState({}, document.title, urlWithoutCode);
      const role = await getUserRole();
      const redirectUrl =
        role === "author"
          ? `${window.location.href}?authorMode=true`
          : window.location.href;
      const { url } = await AuthorizeGithubBackend(assignmentId, redirectUrl);
      if (url) {
        window.open(url, "_self");
      }
    } catch (error) {
      showErrorOnce("Failed to authenticate with GitHub.");
    }
  };

  useEffect(() => {
    const initialize = async () => {
      setLoading(true);

      if (token) {
        setLoading(false);
        return;
      }

      const code = searchParams?.get("code");
      if (code && code.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const returnedToken = await exchangeGithubCodeForToken(code);
        if (returnedToken) {
          const isValid = await validateToken(returnedToken);
          if (isValid) {
            setToken(returnedToken);

            const localUrl = window.location.href;
            const urlWithoutCode = localUrl.split("?")[0];
            window.history.replaceState({}, document.title, urlWithoutCode);
          }
        }
        setLoading(false);
        return;
      }

      const backendToken = await getStoredGithubToken();
      if (backendToken) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const isValid = await validateToken(backendToken);
        if (isValid) {
          setToken(backendToken);
        } else {
          showErrorOnce(
            "Stored token is invalid or expired. Please reauthenticate.",
          );
        }
        setLoading(false);
        return;
      }

      if (!authAttempted) {
        setAuthAttempted(true);
        setLoading(false);
        void authenticateUser();
      } else {
        setLoading(false);
        showErrorOnce(
          "Unable to authenticate with GitHub. Please try again later.",
        );
      }
    };

    void initialize();
  }, [token, searchParams, authAttempted]);

  async function validateToken(testToken: string): Promise<boolean> {
    const testOctokit = new Octokit({ auth: testToken });
    try {
      await testOctokit.request("GET /user");
      return true;
    } catch (error) {
      return false;
    }
  }

  useEffect(() => {
    if (token && owner === null) {
      void fetchRepos();
    }
  }, [token, owner]);

  const octokit = token ? new Octokit({ auth: token }) : null;

  const fetchRepos = async () => {
    if (!octokit || !token) return;
    try {
      const { data } = await octokit.repos.listForAuthenticatedUser();

      const orgs = await octokit.orgs.listForAuthenticatedUser();
      const orgRepos = await Promise.all(
        orgs.data.map(async (org) => {
          const orgRepos = await octokit.repos.listForOrg({
            org: org.login,
          });
          return orgRepos.data.map((repo) => ({
            ...repo,
            owner: { login: org.login },
          }));
        }),
      );
      const allRepos = [...data, ...orgRepos.flat()];
      setRepos(allRepos);
      setOwner(data[0]?.owner?.login || null);
    } catch (error) {
      showErrorOnce(
        "Your GitHub token might have expired. Please reauthenticate.",
      );

      setToken(null);
    }
  };

  const fetchRepoContents = async (repo: string, path: string[] = []) => {
    if (!octokit) return;

    const selectedRepoData = repos.find((r) => r.name === repo);

    try {
      const ownerName = selectedRepoData?.owner?.login || owner;

      const { data } = await octokit.repos.getContent({
        owner: ownerName,
        repo,
        path: path.join("/"),
      });

      const contentArray = Array.isArray(data) ? data : [];
      contentArray.sort((a, b) => {
        if (a.type === b.type) {
          return a.name.localeCompare(b.name);
        }
        if (a.type === "dir" && b.type !== "dir") return -1;
        if (b.type === "dir" && a.type !== "dir") return 1;
        return 0;
      });

      const updatedContentArray = contentArray.map((item) => ({
        ...item,
        owner: { login: ownerName },
        repo: selectedRepoData,
      }));
      setRepoContents(updatedContentArray);
      setCurrentPath(path);
      setSelectedRepo(repo);
      setOwner(ownerName);
    } catch (error) {
      showErrorOnce("Failed to load repository contents.");
    }
  };

  const handleDeselectRepo = () => {
    setSelectedRepo(null);
    setRepoContents([]);
    setCurrentPath([]);
  };
  const handleSearchForFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value.trim();
    setSearchQuery(query);

    if (searchTimer) clearTimeout(searchTimer);

    if (query.length === 0) {
      const timer = setTimeout(() => {
        if (selectedRepo && owner && octokit) {
          void fetchRepoContents(selectedRepo, currentPath);
        }
      }, 500);
      setSearchTimer(timer);
      return;
    }

    if (!octokit || !selectedRepo || !owner) return;

    const timer = setTimeout(async () => {
      setLoadingSearch(true);

      try {
        const { data } = await octokit.search.code({
          q: `filename:${query} repo:${owner}/${selectedRepo}`,
          per_page: 30,
        });

        if (data.items.length > 0) {
          const filteredFiles = data.items.filter((item: { name: string }) =>
            item.name.toLowerCase().startsWith(query.toLowerCase()),
          );

          if (filteredFiles.length > 0) {
            const searchResults: RepoContentItem[] = filteredFiles.map(
              (item: {
                name: string;
                path: string;
                sha: string;
                html_url: string;
              }) => {
                const url = new URL(item.html_url);
                const pathnameParts = url.pathname.split("/");
                const [
                  empty,
                  repoOwner,
                  repoName,
                  blob,
                  branch,
                  ...filePathParts
                ] = pathnameParts;

                const rawUrl = `https://raw.githubusercontent.com/${repoOwner}/${repoName}/${branch}/${filePathParts.join(
                  "/",
                )}`;

                return {
                  name: item.name,
                  download_url: rawUrl,
                  type: "file" as const,
                  path: item.path,
                  sha: item.sha,
                  url: item.html_url,
                  owner: { login: repoOwner },
                  repo: repos.find((r) => r.name === repoName),
                };
              },
            );

            setRepoContents(searchResults);
          } else {
            await searchDirectories(query);
          }
        } else {
          await searchDirectories(query);
        }
      } catch (error) {
        toast.error("Error searching for files or folders. Please try again.");
      } finally {
        setLoadingSearch(false);
      }
    }, 500);

    setSearchTimer(timer);
  };

  const searchDirectories = async (query: string) => {
    if (!octokit || !selectedRepo || !owner) return;
    const defaultBranch =
      repos.find((r) => r.name === selectedRepo)?.default_branch || "main";

    const treeData = await octokit.git.getTree({
      owner,
      repo: selectedRepo,
      tree_sha: defaultBranch,
      recursive: "1",
    });

    const matchingDirs = treeData.data.tree
      .filter((item) => item.type === "tree")
      .filter((item) => {
        const dirName = item.path.split("/").pop() || "";
        return dirName.toLowerCase().startsWith(query.toLowerCase());
      })
      .map((item) => ({
        name: item.path.split("/").pop() || "",
        path: item.path,
        type: "dir" as const,
        sha: item.sha,
        download_url: null,
        url: "",
      }));

    if (matchingDirs.length > 0) {
      setRepoContents(matchingDirs as RepoContentItem[]);
    } else {
      toast.error("No files or folders found matching your search.");
    }
  };

  const handleSaveSelection = async () => {
    if (!octokit) {
      showErrorOnce("Missing required data to fetch file content.");
      return;
    }

    try {
      const fileContents = await Promise.all(
        selectedFiles.map(async (file) => {
          if (!file.owner || !file.repo || !file.path) {
            throw new Error(
              `File missing owner/repo/path: ${JSON.stringify(file, null, 2)}`,
            );
          }

          const { data } = await octokit.repos.getContent({
            owner: file.owner,
            repo: file.repo.name,
            path: file.path,
          });

          if (data && "content" in data && data.content) {
            return {
              filename: file.filename,
              content: atob(data.content),
              githubUrl: file.githubUrl,
            } as learnerFileResponse;
          } else {
            throw new Error(
              `Content not available for file: ${file.path} in ${file.repo.name}`,
            );
          }
        }),
      );
      onFileChange(
        fileContents.map((file) => ({
          filename: file.filename,
          content: file.content,
          githubUrl: file.githubUrl,
        })),
        questionId,
      );
      toast.success("Files added successfully!");
      onClose();
    } catch (error) {
      showErrorOnce("Failed to save file selection. Please try again.");
    }
  };
  if (loading) {
    return (
      <Modal onClose={onClose} Title="GitHub File Selector">
        <div className="p-6 text-center">Loading...</div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} Title="GitHub File Selector">
      <AnimatePresence>
        <motion.div
          key="github-modal-content"
          initial={{ opacity: 0, y: 10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.95 }}
          transition={{ duration: 0.3 }}
          className="pt-2 px-6 rounded-b-lg max-h-[70vh] overflow-y-auto"
        >
          {!token ? (
            <div className="flex flex-col items-center gap-y-4">
              <p className="text-sm text-gray-600 text-center">
                Your GitHub token is invalid or expired.
              </p>
              <button
                onClick={authenticateUser}
                className="bg-gray-600 hover:bg-gray-700 text-white font-semibold py-2 px-6 rounded-lg transition-colors duration-200 ease-in-out"
              >
                Re-Authorize
              </button>
            </div>
          ) : selectedRepo ? (
            <motion.div
              key="repo-content"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.3 }}
            >
              <div className="relative mb-4">
                <IconSearch className="h-5 w-5 text-gray-500 absolute top-1/2 left-4 transform -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search for files..."
                  value={searchQuery}
                  onChange={handleSearchForFiles}
                  className="pl-10 pr-4 py-2 w-full rounded-lg border border-gray-200 focus:outline-none focus:ring-violet-500 focus:border-violet-500"
                />
              </div>

              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-x-[1px]">
                  <button
                    onClick={() => {
                      if (currentPath.length === 0) {
                        handleDeselectRepo();
                      } else {
                        const newPath = currentPath.slice(0, -1);
                        void fetchRepoContents(selectedRepo, newPath);
                      }
                    }}
                    className="flex items-center text-gray-500 hover:text-gray-600 transition-colors duration-200 font-medium"
                  >
                    <ArrowLeftIcon className="mr-1 h-5 w-5" />
                  </button>
                  <button
                    className={`text-md font-semibold text-gray-800 truncate 
                    ${
                      currentPath.length === 0
                        ? "text-violet-500"
                        : "hover:text-violet-600"
                    }
                      `}
                    onClick={() => fetchRepoContents(selectedRepo, [])}
                  >
                    {selectedRepo}
                  </button>

                  {currentPath.map((dir, index) => (
                    <div key={dir} className="flex items-center gap-x-[1px]">
                      <span className="text-gray-500">/</span>
                      <button
                        onClick={() =>
                          fetchRepoContents(
                            selectedRepo,
                            currentPath.slice(0, index + 1),
                          )
                        }
                        className={` transition-colors duration-200 font-medium ${
                          index === currentPath.length - 1
                            ? "text-violet-500 underline hover:text-violet-600"
                            : "text-gray-500 hover:text-violet-600"
                        }`}
                      >
                        {dir}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 border-t border-gray-200 max-h-[60vh]">
                <div className="p-4 overflow-y-auto mb-20">
                  <h2 className="text-lg font-bold text-gray-700 mb-4">
                    Folders and Files
                  </h2>
                  {loadingSearch ? (
                    <div className="flex items-center justify-center">
                      <p className="text-gray-500">Searching...</p>
                    </div>
                  ) : (
                    <>
                      {repoContents.map((content: RepoContentItem) => (
                        <motion.div
                          key={content.sha}
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: 0.2 }}
                          className={`px-4 py-3 bg-white rounded-lg hover:shadow-md transition-shadow duration-200 flex flex-col mb-2 border border-gray-200
                          ${
                            content.type === "dir"
                              ? ""
                              : selectedFiles.some(
                                    (file) =>
                                      file.githubUrl === content.download_url,
                                  )
                                ? "border border-violet-500"
                                : ""
                          }
                            `}
                        >
                          {content.type === "dir" ? (
                            <button
                              onClick={() =>
                                fetchRepoContents(selectedRepo, [
                                  ...currentPath,
                                  content.name,
                                ])
                              }
                              className="flex items-center text-gray-600 hover:text-gray-700 font-medium transition-colors duration-200"
                            >
                              <FolderIcon className="mr-2 h-5 w-5" />
                              {content.name}
                            </button>
                          ) : (
                            <div className="flex items-center gap-x-2">
                              <div className="flex items-center justify-between w-full">
                                <button
                                  className={`flex items-center font-medium transition-colors duration-200  max-w-[calc(100%-4rem)]
                                     ${
                                       selectedFiles.some(
                                         (file) =>
                                           file.githubUrl ===
                                           content.download_url,
                                       )
                                         ? "text-violet-500"
                                         : "text-gray-600 hover:text-violet-600"
                                     }`}
                                  onClick={() => {
                                    if (
                                      selectedFiles.some(
                                        (file) =>
                                          file.githubUrl ===
                                          content.download_url,
                                      )
                                    ) {
                                      setSelectedFiles(
                                        selectedFiles.filter(
                                          (file) =>
                                            file.githubUrl !==
                                            content.download_url,
                                        ),
                                      );
                                    } else {
                                      setSelectedFiles([
                                        ...selectedFiles,
                                        {
                                          filename: content.name,
                                          path: content.path,
                                          owner: content.owner?.login || owner,
                                          repo: content.repo,
                                          githubUrl: content.download_url,
                                          content: "",
                                        },
                                      ]);
                                    }
                                  }}
                                >
                                  <DocumentTextIcon className="mr-2 h-5 w-5" />
                                  <span className="truncate text-nowrap">
                                    {content.name}
                                  </span>
                                </button>
                                <button
                                  onClick={() =>
                                    octokit &&
                                    openFileInNewTab(
                                      content.download_url,
                                      octokit,
                                    )
                                  }
                                  className="transition-colors duration-200 pr-2 underline"
                                >
                                  <ArrowTopRightOnSquareIcon className="h-5 w-5 hover:text-violet-600" />
                                </button>
                              </div>
                            </div>
                          )}
                        </motion.div>
                      ))}
                    </>
                  )}
                </div>

                <div className="p-4 border-l border-gray-200 overflow-y-auto">
                  <h2 className="text-lg font-bold text-gray-700 mb-4">
                    Selected Files
                  </h2>
                  {selectedFiles.length > 0 ? (
                    <ul className="space-y-2">
                      {selectedFiles.map((fileUrl, index) => (
                        <li
                          key={index}
                          className="flex items-center w-full justify-between px-4 py-3 bg-white rounded-lg shadow hover:shadow-md transition-shadow duration-200 border border-violet-500"
                        >
                          <button
                            className="flex items-center gap-x-2"
                            onClick={() =>
                              setSelectedFiles(
                                selectedFiles.filter(
                                  (file) =>
                                    file.githubUrl !== fileUrl.githubUrl,
                                ),
                              )
                            }
                          >
                            <DocumentTextIcon className="h-5 w-5 text-violet-500" />
                            <span className="text-violet-600 truncate">
                              {fileUrl.filename}
                            </span>
                          </button>
                          <button
                            onClick={() =>
                              octokit &&
                              openFileInNewTab(fileUrl.githubUrl, octokit)
                            }
                            className="transition-colors duration-200 pr-2 underline"
                          >
                            <ArrowTopRightOnSquareIcon className="h-5 w-5 hover:text-violet-600" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-gray-500">No files selected.</p>
                  )}
                </div>
              </div>
            </motion.div>
          ) : (
            token && (
              <motion.div
                key="repo-list"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.3 }}
              >
                <p className="text-sm text-gray-700 mb-2">
                  Select a repository to browse its files:
                </p>
                <div className="my-4">
                  {Object.entries(
                    repos.reduce((acc: Record<string, RepoType[]>, repo) => {
                      const owner = repo.owner.login;
                      if (!acc[owner]) acc[owner] = [];
                      acc[owner].push(repo);
                      return acc;
                    }, {}),
                  )
                    .sort(([ownerA], [ownerB]) => ownerA.localeCompare(ownerB))
                    .map(([owner, ownerRepos]) => (
                      <div
                        key={owner}
                        className={
                          repos[repos.length - 1].owner.login === owner
                            ? ""
                            : "border-b border-gray-200 pb-4"
                        }
                      >
                        <h2 className="text-lg font-bold text-gray-700 my-4">
                          {owner}/
                        </h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {ownerRepos
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((repo) => (
                              <motion.div
                                key={repo.id}
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ duration: 0.2 }}
                                className="p-4 bg-white rounded-lg shadow hover:shadow-md transition-shadow duration-200 flex items-center justify-between hover:cursor-pointer"
                                onClick={() => fetchRepoContents(repo.name)}
                              >
                                <span className="text-gray-700 font-medium truncate">
                                  {repo.name}
                                </span>
                              </motion.div>
                            ))}
                        </div>
                      </div>
                    ))}
                </div>
              </motion.div>
            )
          )}

          {selectedRepo && selectedFiles.length > 0 && (
            <div className="fixed bottom-0 left-0 right-0 p-4 flex justify-between items-center border-t border-gray-200 bg-white">
              <button
                onClick={() => handleDeselectRepo()}
                className=" text-black font-semibold py-3 px-4 rounded-lg transition-colors duration-200 ease-in-out border border-gray-200 shadow-sm hover:shadow-md"
              >
                Return to Repo List
              </button>
              <button
                onClick={handleSaveSelection}
                className="bg-violet-600 hover:bg-violet-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors duration-200 ease-in-out shadow-sm hover:shadow-md"
              >
                Save Selections
              </button>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </Modal>
  );
};

export default GithubModal;
