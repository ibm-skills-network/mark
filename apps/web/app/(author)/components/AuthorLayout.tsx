// AuthorLayout.tsx
import DynamicTextBoxContainer from './DynamicTextBoxContainer';
import TextBox from './Textbox';
import PageComponent from './PageComponent';
import AuthorIntroduction from './AuthorIntroduction';

interface Props {}

function AuthorLayout(props: Props) {
  return (
    <PageComponent>
      {(currentPage) => (
        <div>
          {currentPage === 1 && <AuthorIntroduction />}
          {currentPage === 2 ? (
            <div>
              <div className="mt-0">
                <DynamicTextBoxContainer />
              </div>
              <TextBox />
            </div>
          ) : (
            <div>Content for other pages</div>
          )}
        </div>
      )}
    </PageComponent>
  );
}

export default AuthorLayout;
