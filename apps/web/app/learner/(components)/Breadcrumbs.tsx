import { ChevronRightIcon, HomeIcon } from "@heroicons/react/24/solid";

interface Page {
  name: string;
  href: string;
  current: boolean;
}

interface Props {
  homeHref?: string;
  pages?: Page[];
}

function Breadcrumbs(props: Props) {
  const {
    homeHref = "/",
    pages = [
      { name: "Projects", href: "#", current: false },
      { name: "Project Nero", href: "#", current: true },
    ],
  } = props;

  return (
    <nav className="flex" aria-label="Breadcrumb">
      <ol className="flex items-center space-x-4">
        <li>
          <div>
            <a href={homeHref} className="text-gray-400 hover:text-gray-500">
              <HomeIcon className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
              <span className="sr-only">Home</span>
            </a>
          </div>
        </li>
        {pages.map((page) => (
          <li key={page.name}>
            <div className="flex items-center">
              <ChevronRightIcon
                className="h-5 w-5 flex-shrink-0 text-gray-400"
                aria-hidden="true"
              />

              <a
                href={page.href}
                className="ml-4 text-sm font-medium leading-5 text-gray-500 hover:text-gray-700"
                aria-current={page.current ? "page" : undefined}
              >
                {page.name}
              </a>
            </div>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export default Breadcrumbs;
