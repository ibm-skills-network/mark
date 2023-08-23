import { redirect } from "next/navigation";

interface Props {}

function AuthorLayout(props: Props) {
  redirect("/author/introduction");
}

export default AuthorLayout;
