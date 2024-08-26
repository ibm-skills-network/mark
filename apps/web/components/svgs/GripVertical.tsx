interface Props {
  className?: string;
  [key: string]: any; // This allows for any additional props with an explicit type
}

const GripVertical: React.FC<Props> = (props) => {
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
      <g clip-path="url(#clip0_871_25132)">
        <path
          d="M5 2C5.82843 2 6.5 2.67157 6.5 3.5C6.5 4.32843 5.82843 5 5 5C4.17157 5 3.5 4.32843 3.5 3.5C3.5 2.67157 4.17157 2 5 2Z"
          fill="#6B7280"
        />
        <path
          d="M5 6.5C5.82843 6.5 6.5 7.17157 6.5 8C6.5 8.82843 5.82843 9.5 5 9.5C4.17157 9.5 3.5 8.82843 3.5 8C3.5 7.17157 4.17157 6.5 5 6.5Z"
          fill="#6B7280"
        />
        <path
          d="M6.5 12.5C6.5 11.6716 5.82843 11 5 11C4.17157 11 3.5 11.6716 3.5 12.5C3.5 13.3284 4.17157 14 5 14C5.82843 14 6.5 13.3284 6.5 12.5Z"
          fill="#6B7280"
        />
        <path
          d="M11 2C11.8284 2 12.5 2.67157 12.5 3.5C12.5 4.32843 11.8284 5 11 5C10.1716 5 9.5 4.32843 9.5 3.5C9.5 2.67157 10.1716 2 11 2Z"
          fill="#6B7280"
        />
        <path
          d="M11 6.5C11.8284 6.5 12.5 7.17157 12.5 8C12.5 8.82843 11.8284 9.5 11 9.5C10.1716 9.5 9.5 8.82843 9.5 8C9.5 7.17157 10.1716 6.5 11 6.5Z"
          fill="#6B7280"
        />
        <path
          d="M12.5 12.5C12.5 11.6716 11.8284 11 11 11C10.1716 11 9.5 11.6716 9.5 12.5C9.5 13.3284 10.1716 14 11 14C11.8284 14 12.5 13.3284 12.5 12.5Z"
          fill="#6B7280"
        />
      </g>
    </svg>
  );
};
export default GripVertical;
