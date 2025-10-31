export const OPENAI_LLM_PROVIDER_4o = "OPENAI_LLM_PROVIDER_4o";
export const OPENAI_LLM_PROVIDER_mini = "OPENAI_LLM_PROVIDER_mini";
export const ALL_LLM_PROVIDERS = Symbol("ALL_LLM_PROVIDERS");

export const PROMPT_PROCESSOR = "PROMPT_PROCESSOR";
export const MODERATION_SERVICE = "MODERATION_SERVICE";
export const TOKEN_COUNTER = "TOKEN_COUNTER";
export const USAGE_TRACKER = "USAGE_TRACKER";
export const LLM_PRICING_SERVICE = "LLM_PRICING_SERVICE";
export const LLM_ASSIGNMENT_SERVICE = "LLM_ASSIGNMENT_SERVICE";
export const LLM_RESOLVER_SERVICE = "LLM_RESOLVER_SERVICE";

export const TEXT_GRADING_SERVICE = "TEXT_GRADING_SERVICE";
export const FILE_GRADING_SERVICE = "FILE_GRADING_SERVICE";
export const IMAGE_GRADING_SERVICE = "IMAGE_GRADING_SERVICE";
export const URL_GRADING_SERVICE = "URL_GRADING_SERVICE";
export const PRESENTATION_GRADING_SERVICE = "PRESENTATION_GRADING_SERVICE";
export const VIDEO_PRESENTATION_GRADING_SERVICE =
  "VIDEO_PRESENTATION_GRADING_SERVICE";
export const GRADING_JUDGE_SERVICE = "GRADING_JUDGE_SERVICE";
export const GRADING_THRESHOLD_SERVICE = "GRADING_THRESHOLD_SERVICE";

export const QUESTION_GENERATION_SERVICE = "QUESTION_GENERATION_SERVICE";
export const RUBRIC_SERVICE = "RUBRIC_SERVICE";
export const TRANSLATION_SERVICE = "TRANSLATION_SERVICE";
export const VALIDATOR_SERVICE = "VALIDATOR_SERVICE";

export const DEFAULT_LLM_MODEL = "gpt-4o";

export const AVAILABLE_MODELS = {
  OPENAI_GPT4O: "gpt-4o",
  OPENAI_GPT4O_MINI: "gpt-4o-mini",
} as const;

export const RESPONSE_TYPE_SPECIFIC_INSTRUCTIONS = {
  CODE: `
    **Feedback Structure:**
    Provide feedback in the following format:

    1. **Accuracy**: Assess whether the response meets the task requirements and identify any discrepancies.
    2. **Efficiency**: Discuss the approach taken and identify any areas for optimization.
    3. **Style**: Examine the clarity, readability, and presentation of the response, noting areas for improvement.
    4. **Practices**: Comment on adherence to best practices, including maintainability, modularity, and clarity.
    5. **Strengths**: Highlight notable features or aspects of the response that demonstrate understanding or innovation.

    **Instructions for Feedback:**
    - Ensure feedback is constructive and actionable.
    - Avoid revealing the correct answer directly.
    - Provide concise, professional feedback to guide the learner's improvement.
  `,
  ESSAY: `
    Critique the essay based on:
    - **Depth of Analysis**: Assess how well the essay examines the topic, including insights and critical thinking.
    - **Structure**: Comment on the clarity of the introduction, body, and conclusion.
    - **Clarity and Writing Style**: Evaluate grammar, vocabulary, and sentence structure for precision and readability.
    - **Evidence and References**: Determine the quality and appropriateness of sources cited or evidence provided.
    - **Argument Development**: Critique how well the arguments are articulated and supported.
    - **Creativity**: Note any unique perspectives or original ideas presented in the essay.
  `,
  REPORT: `
    Critique the report based on:
    - **Completeness**: Does the report cover all required points and provide sufficient depth?
    - **Data Presentation**: Evaluate the clarity and accuracy of tables, charts, or other visual aids.
    - **Organization**: Assess logical flow, headings, and layout for readability.
    - **Clarity of Communication**: Comment on grammar, syntax, and overall writing quality.
    - **Relevance**: Ensure that the content strictly adheres to the assignment objectives.
    - **Actionable Insights**: Highlight the value of conclusions or recommendations, if any.
  `,
  PRESENTATION: `
    Critique the presentation based on:
    - **Content Depth**: Evaluate the quality of information provided and its alignment with the question.
    - **Slide Design**: Assess visual appeal, readability, and effective use of graphics and text.
    - **Organization**: Comment on the sequence of ideas and how effectively they are conveyed.
    - **Engagement**: Determine whether the presentation would capture and maintain audience attention.
    - **Clarity of Explanation**: Ensure all points are clearly communicated with minimal ambiguity.
    - **Professionalism**: Evaluate adherence to professional standards in tone and design.
  `,
  VIDEO: `
    Critique the video submission based on:
    - **Content Accuracy**: Ensure the video covers the required material correctly and thoroughly.
    - **Presentation Skills**: Evaluate speech clarity, tone, pacing, and overall communication effectiveness.
    - **Visual and Audio Quality**: Assess lighting, sound, and any video effects used.
    - **Structure**: Comment on the logical flow and coherence of ideas.
    - **Engagement and Creativity**: Highlight how well the video captures attention and uses creative elements.
    - **Relevance**: Ensure all content aligns with the question's requirements.
  `,
  AUDIO: `
    Critique the audio submission based on:
    - **Content Relevance**: Verify that the audio content directly addresses the assignment question.
    - **Clarity of Speech**: Evaluate pronunciation, tone, and pacing for effective communication.
    - **Audio Quality**: Assess background noise, volume levels, and overall sound clarity.
    - **Structure**: Comment on the organization of ideas and logical flow.
    - **Engagement**: Determine how well the audio captures and maintains listener interest.
    - **Professionalism**: Evaluate the overall presentation and adherence to professional standards.
  `,
  IMAGE: `
    Critique the image submission based on:
    - **Content Relevance**: Ensure the image aligns with the assignment question and objectives.
    - **Visual Clarity**: Assess the quality, focus, and overall presentation of the image.
    - **Creativity**: Evaluate the originality and thoughtfulness of the image.
    - **Technical Execution**: Comment on composition, lighting, and any editing techniques used.
    - **Engagement**: Determine how well the image captures attention and conveys its message.
    - **Professionalism**: Ensure adherence to professional standards in visual communication.
  `,
  IMAGES: `
    Critique the image submission based on:
    - **Content Relevance**: Ensure the image aligns with the assignment question and objectives.
    - **Visual Clarity**: Assess the quality, focus, and overall presentation of the image.
    - **Creativity**: Evaluate the originality and thoughtfulness of the image.
    - **Technical Execution**: Comment on composition, lighting, and any editing techniques used.
    - **Engagement**: Determine how well the image captures attention and conveys its message.
    - **Professionalism**: Ensure adherence to professional standards in visual communication.
  `,
  URL: `
    Critique the URL submission based on:
    - **Content Relevance**: Ensure the linked content directly addresses the assignment question.
    - **Quality of Information**: Assess the credibility and reliability of the source.
    - **Presentation**: Evaluate how well the content is organized and presented.
    - **Engagement**: Determine how effectively the content captures and maintains interest.
    - **Professionalism**: Ensure adherence to professional standards in tone and presentation.
  `,
  TEXT: `
    Critique the text submission based on:
    - **Content Relevance**: Ensure the text aligns with the assignment question and objectives.
    - **Clarity and Coherence**: Evaluate the organization of ideas and logical flow.
    - **Grammar and Style**: Assess writing quality, including grammar, punctuation, and vocabulary.
    - **Depth of Analysis**: Comment on the thoroughness of the analysis and insights provided.
    - **Engagement**: Determine how well the text captures and maintains reader interest.
    - **Professionalism**: Ensure adherence to professional standards in written communication.
  `,
  FILE: `
    Critique the file submission based on:
    - **Content Relevance**: Ensure the file aligns with the assignment question and objectives.
    - **Quality of Information**: Assess the credibility and reliability of the content.
    - **Presentation**: Evaluate how well the content is organized and presented.
    - **Engagement**: Determine how effectively the content captures and maintains interest.
    - **Professionalism**: Ensure adherence to professional standards in tone and presentation.
  `,
  RUBRIC: `
    Critique the rubric submission based on:
    - **Clarity**: Ensure the rubric is easy to understand and follow.
    - **Completeness**: Assess whether all necessary criteria are included.
    - **Relevance**: Evaluate the alignment of the rubric with the assignment objectives.
    - **Fairness**: Comment on the fairness and objectivity of the grading criteria.
    - **Detail**: Determine if the rubric provides sufficient detail for effective evaluation.
    - **Professionalism**: Ensure adherence to professional standards in tone and presentation.
  `,
  REPO: `
    Critique the repository submission based on:
    - **Repository Structure**: Evaluate organization, file naming, and directory structure.
    - **Code Quality**: Assess code readability, maintainability, and adherence to best practices.
    - **Documentation**: Review README quality, code comments, and API documentation.
    - **Testing**: Evaluate test coverage, quality, and CI/CD setup if applicable.
    - **Version Control**: Comment on commit history, branching strategy, and collaboration practices.
    - **Technical Excellence**: Highlight innovative solutions or exceptional implementation details.
  `,
  SPREADSHEET: `
    Critique the spreadsheet submission based on:
    - **Data Organization**: Evaluate structure, naming conventions, and data relationships.
    - **Formula Accuracy**: Assess correctness and efficiency of formulas and calculations.
    - **Visual Presentation**: Review formatting, charts, and visual elements for clarity.
    - **Documentation**: Comment on cell comments, legend, and explanatory notes.
    - **Functionality**: Evaluate any macros, pivot tables, or advanced features used.
    - **Professional Standards**: Ensure adherence to spreadsheet best practices.
  `,
  LIVE_RECORDING: `
    Critique the live recording submission based on:
    - **Content Delivery**: Evaluate accuracy and completeness of presented information.
    - **Presentation Skills**: Assess confidence, clarity, and engagement techniques.
    - **Time Management**: Comment on pacing and adherence to time constraints.
    - **Audience Interaction**: Review handling of questions or interactive elements.
    - **Technical Execution**: Evaluate audio/video quality and any technical issues.
    - **Overall Impact**: Determine effectiveness in conveying the intended message.
  `,
  OTHER: `
    Provide comprehensive feedback based on:
    - **Content Quality**: Evaluate relevance, accuracy, and completeness.
    - **Organization**: Assess structure and logical flow of information.
    - **Technical Execution**: Comment on the quality of implementation or presentation.
    - **Creativity and Innovation**: Highlight unique approaches or solutions.
    - **Adherence to Requirements**: Ensure all assignment criteria are met.
    - **Areas for Improvement**: Provide specific, actionable suggestions.
  `,
};
