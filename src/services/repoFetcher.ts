import { githubAxios } from "./githubClient";
import { RepoMeta, RawContributor, RawTag } from "../types";

export async function fetchRepoMeta(
  owner: string,
  repo: string,
): Promise<RepoMeta> {
  const { data } = await githubAxios.get(`/repos/${owner}/${repo}`);
  return {
    name: data.name,
    fullName: data.full_name,
    description: data.description,
    language: data.language,
    stars: data.stargazers_count,
    forks: data.forks_count,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    defaultBranch: data.default_branch,
    htmlUrl: data.html_url,
    topics: data.topics || [],
  };
}

export async function fetchContributors(
  owner: string,
  repo: string,
): Promise<RawContributor[]> {
  const { data } = await githubAxios.get(
    `/repos/${owner}/${repo}/contributors`,
    {
      params: { per_page: 30 },
    },
  );
  return data;
}

export async function fetchTags(
  owner: string,
  repo: string,
): Promise<RawTag[]> {
  const { data } = await githubAxios.get(`/repos/${owner}/${repo}/tags`, {
    params: { per_page: 50 },
  });
  return data;
}
