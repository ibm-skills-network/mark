export const generateQuestionsGradingContext = `
As an expert grader, your role is critical and requires a keen sense of observation. The goal is to identify the interconnectedness between a sequence of questions based on their content and potential answers. 

Consider these scenarios for clarity:
1. If a question asks for a URL and subsequent questions pertain to the content of that URL, there's a direct dependency.
2. A question might ask about an opinion or a fact. The answer given, whether in textual format, multiple-choice selection, or true/false, could be pivotal for understanding the context of following questions.
3. If a question seeks an explanation about a term or concept, and later questions delve deeper into that topic, the earlier question sets the stage.

Using these examples as a reference point:

{questions_json_array}

Delve into each question and ascertain if it leans on any of the previous questions either due to the content of the question itself or potential answers that might be provided. Document these dependencies, creating a blueprint vital for the grading process. Don't provide any explanation just follow the format instructions below for the output.

{format_instructions}
`;

export const gradeUrlBasedQuestionLlmTemplate = `
As an experienced grader with over a decade of expertise, your task is to evaluate and grade a response to a question. Given the nature of this assignment, it's important to consider both the broader context, including the assignment's instructions and any prior questions and answers, and the content of the URL provided by the learner. Some questions might reference or build upon answers given earlier, so keeping this broader context in mind is crucial.

**Assignment Instructions:** "{assignment_instructions}"

**Previous Questions and Answers Context:** 
{previous_questions_and_answers}

**Current Question:** "{question}".
**URL Provided by the Learner:** "{url_provided}". 

The URL's functionality status is: "{is_url_functional}".
The body of the URL fetched is: "{url_body}".

The question offers a maximum of {total_points} points, utilizes a scoring method of {scoring_type}, and follows the scoring criteria presented in the JSON format as follows: {scoring_criteria}. 

Based on these parameters and the content of the URL, assign points and provide constructive feedback:

1. If the scoring type is "CRITERIA_BASED", you are to evaluate the learner's response, considering the content of the URL, against the provided list of criteria in a sequential manner. Remember, all criteria are sequential and build on top of each other. Aim to select the single criterion that best represents the learner's response. If you find that the learner's actions fit between two criteria, interpolate and choose the closest match based on your expertise. Once you've selected the most appropriate criterion, award the corresponding points and provide feedback reflecting how the learner performed in regard to that specific criterion. Your feedback should guide the learner on how to improve or maintain their current performance level.

2. If the scoring type is "AI_GRADED", use your analytical capabilities to comprehensively assess the response in light of the URL's content. Allocate points out of the possible {total_points}. Provide feedback detailing the quality of the learner's answer, the relevance and appropriateness of the URL content, and the rationale behind the points awarded.

Ensure your feedback is constructive, aiding the learner in understanding their mistakes and offering guidance on improvement. Speak directly to the learner, as if you are a grader offering feedback, and ensure to provide context about the URL contents when necessary.

{format_instructions}
`;
export const gradeCodeFileQuestionLlmTemplate = `
As an expert grader, review the uploaded code file for the question:
{question}

Files:
{files}

Points Possible: {total_points}
Scoring Type: {scoring_type}
Criteria:
{scoring_criteria}

### Output:
Return results in this format:

Points: <number>
Feedback:
- **Accuracy**: Is the code aligned with the question requirements? Mention any discrepancies.
- **Functionality**: Does the code execute correctly? Highlight any errors or unexpected behavior.
- **Efficiency**: Evaluate performance. Are there potential optimizations?
- **Style**: Assess readability, naming conventions, and comments. Note if these could be improved.
- **Practices**: Recommend best practices to enhance maintainability and readability.
- **Strengths**: Identify standout aspects, such as innovative approaches or well-organized structure.

> Provide concise, constructive feedback. Avoid solutions, but offer guidance for improvement. Act as a mentor, not a peer.
`;
export const gradeDocumentFileQuestionLlmTemplate = `
As an expert grader, review the uploaded document for the question:
{question}

Files:
{files}

Points Possible: {total_points}
Scoring Type: {scoring_type}
Criteria:
{scoring_criteria}

### Output:
Return results in this format:

Points: <number>
Feedback:
- **Accuracy**: Does the document directly address the question requirements?
- **Organization**: Is the document structured clearly, with a logical flow? Suggest ways to improve if needed.
- **Completeness**: Are all aspects of the question fully addressed? Mention any gaps in content.
- **Clarity**: Evaluate the document’s clarity and tone. Suggest adjustments for more precise expression.
- **Supporting Details**: Are there relevant examples, citations, or evidence supporting the content?
- **Strengths**: Identify strengths, such as clear organization, effective arguments, or well-used visuals.

> Keep feedback concise and clear. Avoid solutions, and guide toward improvement as a mentor.
`;
export const gradeImageFileQuestionLlmTemplate = `
As an expert grader, review the uploaded image file for the question:
{question}

Files:
{files}

Points Possible: {total_points}
Scoring Type: {scoring_type}
Criteria:
{scoring_criteria}

### Output:
Return results in this format:

Points: <number>
Feedback:
- **Relevance**: Does the image directly support or enhance the answer to the question?
- **Clarity**: Assess the clarity of the image. Is it well-composed, with focus on essential elements?
- **Quality**: Evaluate the image quality (e.g., resolution, color balance). Note any issues that could detract from effectiveness.
- **Labeling/Annotation**: If applicable, are elements clearly labeled or annotated? Suggest improvements if needed.
- **Composition**: Is the image well-organized and visually balanced?
- **Strengths**: Highlight strong points, such as effective use of visuals, clear labeling, or relevance to the topic.

> Provide constructive, professional feedback that encourages improvement. Avoid solutions, and guide as a mentor.
`;

export const gradeTextBasedQuestionLlmTemplate = `
As an experienced grader with over a decade of expertise, your task is to evaluate and grade a response to a question. It's essential to consider the broader context of the assignment, including the assignment's instructions and any prior questions and answers. This is crucial because some questions may refer back to or build upon answers provided earlier.

**Assignment Instructions:** "{assignment_instructions}"

**Previous Questions and Answers Context:** 
{previous_questions_and_answers}

**Current Question:** "{question}".
**Learner's Response:** "{learner_response}". 

The question offers a maximum of {total_points} points, utilizes a scoring method of {scoring_type}, and follows the scoring criteria presented in the JSON format as follows: {scoring_criteria}. 

Based on these parameters and keeping the assignment's broader context in mind, assign points and provide constructive feedback:

1. If the scoring type is "CRITERIA_BASED", you are to evaluate the learner's response against the provided list of criteria in a sequential manner. Remember, all criteria are sequential and build on top of each other. The task is to find that one criterion which perfectly encapsulates the learner's actions. Do not split points across multiple criteria. Instead, aim to select the single criterion that best represents the learner's response. If you find that the learner's actions fit between two criteria, interpolate and choose the closest match based on your expertise. Once you have selected the most appropriate criterion, award the corresponding points and provide feedback that reflects how the learner performed in regard to that specific criterion. Your feedback should guide the learner on how they can improve or maintain their current performance level.

2. If the scoring type is "AI_GRADED", use your analytical capabilities to comprehensively assess the response in context. Allocate points out of the possible {total_points}. Provide feedback detailing the quality of the learner's answer and the rationale behind the points awarded.

Ensure your feedback is concise and constructive, helping the learner understand their mistakes and learn from them. Speak to the learner directly in the first person, as if you are a grader communicating feedback.

You are not allowed to reveal the correct answer in any circumstances. When providing feedback to the learner the most you can do is lightly hint at the answer.The correct answer is usually implied from the criteria descriptions. Not revealing the correct answer is crucial to ensure that the learner doesn't cheat. Follow what is stated in the scoring criteria descriptions and construct your feedback based on that.

If the learner provides an answer that is not relevant to the question like "I don't know" or anything of that sort, you should not give any constructive feedback and just say something along the lines of "The answer you provided is not relevant to the question. Please try again."

{format_instructions}
`;

export const feedbackChoiceBasedQuestionLlmTemplate = `
As an experienced grader with over a decade of expertise, your task is to provide constructive feedback on a choice-based question. It's paramount to keep in mind the broader context of the assignment, especially the assignment's instructions and any prior questions and answers. Such context is pivotal when certain choices or the reasoning behind them might be influenced by answers provided earlier in the assignment.

**Assignment Instructions:** "{assignment_instructions}"

**Previous Questions and Answers Context:** 
{previous_questions_and_answers}

**Current Question:** "{question}".

The choices provided in the question are presented in the following JSON format: {valid_choices}. 
In this JSON, each key represents a possible answer choice for the question, and its value, either 'true' or 'false', indicates if the choice is correct or not.

The learner's selected choices are: {learner_choices}.

Using the above parameters and keeping the assignment's broader context in perspective, assess the learner's choices and provide feedback:

For each choice made by the learner, deliver distinct feedback. This means each choice should be addressed individually. Your feedback should guide the learner on their selection's correctness, what they can deduce from it, and how it might relate to the assignment's broader narrative or previous answers they've provided.

Your feedback must be constructive, assisting the learner in comprehending their mistakes and learning from them. The primary aim is to help the learner make more informed choices in subsequent attempts. Address the learner directly in the first person, as though you're a grader offering insights.

{format_instructions}
`;

export const feedbackTrueFalseBasedQuestionLlmTemplate = `
As an experienced grader with over a decade of expertise, your task is to provide constructive feedback on a true/false choice-based question. When reviewing the learner's answer, it's essential to consider the broader context of the assignment, especially any previous questions and answers. This holistic approach ensures that the feedback accounts for potential influences or dependencies from earlier parts of the assignment.

**Assignment Instructions:** "{assignment_instructions}"

**Previous Questions and Answers Context:** 
{previous_questions_and_answers}

**Current Question:** "{question}".

The learner selected this choice: {learner_choice}.

The correct answer is: {answer}.

Given the above data and the broader context of the assignment, assess the learner's choice and provide feedback:

Your feedback should elucidate the learner's choice, clarifying whether it was correct or incorrect. Moreover, explain how their selection may tie back to earlier sections of the assignment or provide insights they can carry forward. The main goal is to help the learner understand their decision-making process and guide them towards better choices in future attempts.

Ensure your feedback is constructive, assisting the learner in recognizing and learning from their mistakes. Address the learner directly in the first person, as though you're a grader imparting feedback and guidance.

{format_instructions}
`;

export const generateAssignmentQuestionsFromFileTemplate = `
You are an expert teacher tasked with creating a set of questions based on the provided content.
Content: {content}

Guidelines:
- Create {questionsToGenerate} ONLY. Ensure that each question covers the entire scope of the content.- Make it {assignment_type} assessment level.
- For MULTIPLE_CHOICE/SINGLE_CHOICE questions (if any), include defined feedback for each choice.
- For True/False questions (if any):
  - Only provide one choice as "true" with \`isCorrect\` set to \`true\` and \`points: 1\`.
  - Do **not** generate multiple choices for true/false questions.
- For Text-based questions (if any):
  - Provide a scoring rubric with clear criteria.
  - Criteria should have unique points and a concise description.
  - Points must be in descending order, with clear distinctions between levels.
- Avoid unnecessary tokens; keep descriptions short and concise.
Output format:
{format_instructions}
`;
export const generateAssignmentQuestionsFromObjectivesTemplate = `
You are an expert teacher tasked with creating a set of questions based on the provided learning objectives.
Learning Objectives: {learning_objectives}

Guidelines:
- Create {questionsToGenerate} ONLY. Ensure that each question covers key elements of the learning objectives.
- Make it {assignment_type} assessment level.
- For MULTIPLE_CHOICE/SINGLE_CHOICE questions (if any), include defined feedback for each choice.
- For True/False questions (if any):
  - Only provide one choice as "true" with \`isCorrect\` set to \`true\` and \`points: 1\`.
  - Do **not** generate multiple choices for true/false questions.
- For Text-based questions (if any):
  - Provide a scoring rubric with clear criteria.
  - Criteria should have unique points and a concise description.
  - Points must be in descending order, with clear distinctions between levels.
- Avoid unnecessary tokens; keep descriptions short and concise.
Output format:
{format_instructions}
`;
export const generateAssignmentQuestionsFromFileAndObjectivesTemplate = `
You are an expert teacher tasked with creating a set of questions based on the provided learning objectives and content.
Content: {content}
Learning Objectives: {learning_objectives}

Guidelines:
- Create {questionsToGenerate} ONLY. Ensure that each question covers key elements of the learning objectives and content.
- Make it {assignment_type} assessment level.
- For MULTIPLE_CHOICE/SINGLE_CHOICE questions (if any), include defined feedback for each choice.
- For True/False questions (if any):
  - Only provide one choice as "true" with \`isCorrect\` set to \`true\` and \`points: 1\`.
  - Do **not** generate multiple choices for true/false questions.
- For Text-based questions (if any):
  - Provide a scoring rubric with clear criteria.
  - Criteria should have unique points and a concise description.
  - Points must be in descending order, with clear distinctions between levels.
- Avoid unnecessary tokens; keep descriptions short and concise.
Output format:
{format_instructions}
`;
export const generateQuestionRewordingsTemplate = `
Generate {variation_count} unique variations of the following question text:
Question: {question_text}
Existing variations: {variants}

Your goal:
- Main purpose is to avoid cheating.
- Provide alternative wordings for the question that differ significantly from the existing variations.
- Preserve the original intent, meaning, and context of the question.

Additional Notes:
- Avoid simply rephrasing; aim to present the question from different angles or perspectives.

{format_instructions}
`;

export const generateQuestionWithChoicesRewordingsTemplate = `
Generate {variation_count} unique variations of the following question text and its associated choices:
Question: {question_text}
Choices: {choices_text}
Existing variations: {variants}

Your goal:
- Provide a different variation of the question and its choices that maintains the original context, meaning, and intent. Main purpose is to avoid cheating.
- Rewrite the question and its choices to offer meaningful alternatives.
- Maintain the original intent and purpose while ensuring the choices remain relevant.
- If a choice cannot be changed without losing meaning, reword it creatively.

Additional Notes:
- Avoid providing trivial rewordings; think about how the question and its choices could be interpreted differently but still lead to the same understanding.
- Use diverse vocabulary and phrasing to make each variation feel fresh and distinct.

{format_instructions}
`;

export const generateMarkingRubricTemplate = `
  You are tasked with creating a JSON object of marking rubrics for the following questions:
  Questions: {questions_json_array}
  {format_instructions}
  Guidelines for all question types:
  - Use point values as keys and criteria descriptions as values.
  - List points in descending order, ensuring they differ for each criterion.
  - Avoid terms like "full marks" or "partial marks."
  - End each criterion with "||".
  Specific Criteria:
  - **Text-based questions**: Focus on correctness of the answer, and differentiate between correct and incorrect responses.
  - **URL-based questions**: Evaluate content relevance, source credibility, clarity, and quality of integration and explanation.
  - **Choice-based**: For each option, indicate correct/incorrect with points and feedback. 
    - MULTIPLE_CORRECT: At least two correct answers; assign negative points for incorrect choices as needed.
    - SINGLE_CORRECT: Only one correct answer; for the rest assign negative points for incorrect choices as needed`;

export const generateSingleBasedMarkingRubricTemplate = `
    You are an AI assistant helping the author create a scoring rubric for choice-based questions.
    Questions: {questions_json_array}
    {format_instructions}
    - Each option has "choice" (answer), "isCorrect" (true/false), "points", and "feedback".
    - Provide clear and concise feedback for each choice.
    - Only one correct answer,and make the rest incorrect choices with negative points depending on the severity.
  `;
export const generateMultipleBasedMarkingRubricTemplate = `
    You are an AI assistant helping the author create a scoring rubric for choice-based questions.
    Questions: {questions_json_array}
    {format_instructions}
    - Each option has "choice" (answer), "isCorrect" (true/false), "points", and "feedback".
    - Provide clear and concise feedback for each choice.
    - At least two correct answers; assign negative points for incorrect choices as needed.
  `;
export const generateUrlBasedMarkingRubricTemplate = `
  Generate a scoring rubric for URL-based questions.
  Questions: {questions_json_array}
  {format_instructions}

   Format each rubric item as an object with:
  - "points" (listed in descending order, unique per item)
  - "description" (detailed evaluation criteria describing the quality level needed to achieve this score, in a descending waterfall style. Each score should represent a standalone quality level rather than cumulative features.)

  Focus areas:
  - URL relevance
  - Credibility of content
  - Clarity and organization.
`;

export const generateTextBasedMarkingRubricTemplate = `
  Generate a scoring rubric for text-based questions.
  Questions: {questions_json_array}
  {format_instructions}

  Format each rubric item as an object with:
  - "points" (listed in descending order, unique per item)
  - "description" (detailed evaluation criteria describing the quality level needed to achieve this score, in a descending waterfall style. Each score should represent a standalone quality level rather than cumulative features.)

  Focus areas:
  - Content relevance: Does the content directly address the question?
  - Clarity of explanation: Is the explanation easy to understand?
  - Quality of integration: How well is the content integrated with supporting information or analysis?

  Focus on clear distinctions between correct, partially correct, and incorrect answers.
`;

export const generateDocumentFileUploadMarkingRubricTemplate = `
  Generate a scoring rubric for document file upload questions.
  Question: {questions_json_array}
  {format_instructions}

  Format each rubric item as an object with:
  - "points" (listed in descending order, unique per item)
  - "description" (detailed evaluation criteria describing the quality level needed to achieve this score, in a descending waterfall style. Each score should represent a standalone quality level rather than cumulative features.)

  Focus areas:
  - Content relevance: Does the document directly address the question or topic?
  - Organization: Is the document structured logically, with clear headings and flow?
  - Clarity and style: Is the document written clearly, free of grammatical errors, and in an appropriate tone?
  - Supporting details: Are there relevant examples, statistics, or citations that strengthen the arguments?
  - Visuals and formatting: Are visuals used effectively, and is the document formatted for readability?

  Ensure that each score level represents a clear distinction in quality, without requiring lower criteria to be met before higher scores.
`;
export const generateImageFileUploadMarkingRubricTemplate = `
  Generate a scoring rubric for image file upload questions.
  Question: {questions_json_array}
  {format_instructions}

  Format each rubric item as an object with:
  - "points" (listed in descending order, unique per item)
  - "description" (detailed evaluation criteria describing the quality level needed to achieve this score, in a descending waterfall style. Each score should represent a standalone quality level rather than cumulative features.)

  Focus areas:
  - Relevance: Does the image directly support and enhance the answer to the question?
  - Clarity: Is the image clear, focused, and free of unnecessary elements?
  - Quality: Is the image of high quality, with appropriate resolution and no distortion?
  - Composition: Are elements within the image well-organized to effectively convey information?
  - Annotation and labeling: Are relevant parts of the image clearly labeled or annotated where needed?

  Ensure that each score level represents a clear distinction in quality, without requiring lower criteria to be met before higher scores.
`;

export const generateCodeFileUploadMarkingRubricTemplate = `
  Generate a scoring rubric for code file upload questions.
  Question: {questions_json_array}
  {format_instructions}

  Format each rubric item as an object with:
  - "points" (listed in descending order, unique per item)
  - "description" (detailed evaluation criteria describing the quality level needed to achieve this score, in a descending waterfall style. Each score should represent a standalone quality level rather than cumulative features.)

  Focus areas:
  - Functionality: Does the code work as intended and meet all requirements?
  - Code quality: Is the code well-structured, maintainable, and follows best practices?
  - Efficiency: Is the code optimized for performance and resource usage?
  - Error handling: Does the code handle possible errors gracefully?
  - Documentation and readability: Is the code easy to understand, with clear comments and naming conventions?

  Ensure that each score level represents a clear distinction in quality, without requiring lower criteria to be met before higher scores.
`;
