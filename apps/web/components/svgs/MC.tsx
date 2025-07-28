interface Props {
  className?: string;
  [key: string]: any;
}

const MultipleChoiceSVG: React.FC<Props> = (props) => {
  const { className, ...restOfProps } = props;

  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...restOfProps}
    >
      <rect x="0.5" y="0.5" width="15" height="15" rx="7.5" stroke="#9CA3AF" />
      <rect x="3" y="3" width="10" height="10" rx="5" fill="#6B7280" />
    </svg>
  );
};
export default MultipleChoiceSVG;
