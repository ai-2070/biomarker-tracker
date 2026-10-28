import { LinkButton, PageTitle } from "../components/ui";
import { href } from "../router";

export function NotFound() {
  return (
    <>
      <PageTitle sub="This page doesn't exist. It may have been moved.">Page not found</PageTitle>
      <LinkButton href={href({ name: "overview" })}>Go to your results</LinkButton>
    </>
  );
}
