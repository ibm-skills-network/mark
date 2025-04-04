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

Mark the question as {grading_type} based on the provided criteria and the content of the URL.

Make sure your feedback is in language code: {language} 

Provide reason why you provided the points you did and how the content of the URL influenced your decision.

{responseSpecificInstruction}

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
{format_instructions}

Make sure your feedback is in language code: {language} 
Include reasons why you awarded the points you did and how the code quality influenced your decision.
Your feedback should explain exactly why you awarded the points 
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
{format_instructions}
You need to provide feedback in language code: {language}
Include reasons why you awarded the points you did and how the document quality influenced your decision.
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
Include reasons why you awarded the points you did and how the image quality influenced your decision.
> Provide constructive, professional feedback that encourages improvement. Avoid solutions, and guide as a mentor.
`;

export const gradeTextBasedQuestionLlmTemplate = `
As an experienced grader with over a decade of expertise, your task is to evaluate and grade a response to a question. It's essential to provide feedback structured into key areas of evaluation. 

**Assignment Instructions:** "{assignment_instructions}"

**Previous Questions and Answers Context:** 
{previous_questions_and_answers}

**Current Question:** "{question}".
**Learner's Response:** "{learner_response}". 

The question offers a maximum of {total_points} points and follows the scoring criteria presented in the JSON format as follows: {scoring_criteria}. 

**Scoring Rules:**
- If the scoring type is "CRITERIA_BASED", award points based on the most relevant criterion in the list. Each criterion is standalone and represents a distinct quality level. Select the single criterion that best matches the learner's response.
- If the scoring type is "AI_GRADED", allocate points out of the possible {total_points} based on the overall assessment of the response quality.

If the response is irrelevant (e.g., "I don't know"), state: "The answer you provided is not relevant to the question. Please try again."
Make sure your feedback is in language code: {language} 
**Additional Instructions for Response Type:** "{responseSpecificInstruction}"
Include reasons why you awarded the points you did and how the response quality influenced your decision.
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
 Generate exactly {totalQuestionsToGenerate} of questions based on the distribution specified below. No more, no less:
  - MULTIPLE_CHOICE: {multipleChoice} questions.
  - MULTIPLE_SELECT: {multipleSelect} questions.
  - TEXT_RESPONSE: {textResponse} questions.
  - TRUE_FALSE: {trueFalse} questions.
- Questions should align with the following difficulty type: {difficultyDescription}.
- Ensure each question covers the entire scope of the content.
- For MULTIPLE_CHOICE/SINGLE_CHOICE questions (if any), include defined feedback for each choice. Make at least 4 choices for each question.
- For TRUE_FALSE questions (if any):
  - Only provide one choice as "true" with \`isCorrect\` set to \`true\` and \`points: 1\`.
  - Do **not** generate multiple choices for TRUE/FALSE questions.
- For TEXT_RESPONSE questions (if any):
  - Provide a scoring rubric with clear criteria.
  - Criteria should have unique points and a concise description.
  - Points must be in descending order, with clear distinctions between levels.
  - Generate enough rubric criteria to cover the entire scope of the learning objectives.
- Avoid unnecessary tokens; keep descriptions short and concise.
Output format:
{format_instructions}
`;

export const gradeRepoQuestionLlmTemplate = `
As an expert grader, review the learner's GitHub repository for the question:
{question}

Repository: {repository}

Points Possible: {total_points}
Scoring Type: {scoring_type}
Criteria:

{scoring_criteria}

### Output:
Return results in this format:
{format_instructions}

Make sure your feedback is in language code: {language} 

> Provide constructive feedback to guide improvement. Avoid providing solutions.
`;

export const generateAssignmentQuestionsFromObjectivesTemplate = `
You are an expert teacher tasked with creating a set of questions based on the provided learning objectives.
Learning Objectives: {learning_objectives}

Guidelines:
 Generate exactly {totalQuestionsToGenerate} of questions based on the distribution specified below. No more, no less:
  - MULTIPLE_CHOICE: {multipleChoice} questions.
  - MULTIPLE_SELECT: {multipleSelect} questions.
  - TEXT_RESPONSE: {textResponse} questions.
  - TRUE_FALSE: {trueFalse} questions.
- Questions should align with the following difficulty type: {difficultyDescription}.
- Ensure each question covers key elements of the learning objectives. Do not deviate from the objectives and maintain a clear focus with no redundancy.
- For MULTIPLE_CHOICE/SINGLE_CHOICE questions (if any), include defined feedback for each choice. Make at least 4 choices for each question.
- For TRUE_FALSE questions (if any):
  - Only provide one choice as "true" with \`isCorrect\` set to \`true\` and \`points: 1\`.
  - Do **not** generate multiple choices for TRUE/FALSE questions.
- For TEXT_RESPONSE questions (if any):
  - Provide a scoring rubric with clear criteria.
  - Criteria should have unique points and a concise description.
  - Points must be in descending order, with clear distinctions between levels.
  - Generate enough rubric criteria to cover the entire scope of the learning objectives.
- Avoid unnecessary tokens; keep descriptions short and concise.
Output format:
{format_instructions}
`;

export const generateAssignmentQuestionsFromFileAndObjectivesTemplate = `
You are an expert teacher tasked with creating a set of questions based on the provided learning objectives and content.
Content: {content}
Learning Objectives: {learning_objectives}

Guidelines:
- Generate exactly {totalQuestionsToGenerate} of questions based on the distribution specified below. No more, no less:
  - MULTIPLE_CHOICE: {multipleChoice} questions.
  - MULTIPLE_SELECT: {multipleSelect} questions.
  - TEXT_RESPONSE: {textResponse} questions.
  - TRUE_FALSE: {trueFalse} questions.
- Questions should align with the following difficulty type: {difficultyDescription}.
- Ensure each question covers key elements of the learning objectives. Do not deviate from the objectives and maintain a clear focus with no redundancy.
- For MULTIPLE_CHOICE/SINGLE_CHOICE questions (if any), include defined feedback for each choice. Make at least 4 choices for each question.
- For TRUE_FALSE questions (if any):
  - Only provide one choice as "true" with \`isCorrect\` set to \`true\` and \`points: 1\`.
  - Do **not** generate multiple choices for TRUE/FALSE questions.
- For TEXT_RESPONSE questions (if any):
  - Provide a scoring rubric with clear criteria.
  - Criteria should have unique points and a concise description.
  - Points must be in descending order, with clear distinctions between levels.
  - Generate enough rubric criteria to cover the entire scope of the learning objectives.
- Avoid unnecessary tokens; keep descriptions short and concise.
Output format:
{format_instructions}
`;

export const generateQuestionRewordingsTemplate = `
Generate {variation_count} creative variants of the following question:
Question: {question_text}
Existing variants: {variants}

Your goal:
- Create distinct versions of the question that can replace the original, maintaining the same intent, meaning, and context.
- Change the question structure, focus, or angle while staying within the same topic and purpose.
- Avoid simple paraphrasing; instead, introduce subtle contextual or structural changes to make the question feel new and engaging.

Additional Notes:
- Keep the level of difficulty and intent consistent with the original question.
- Variants should be creative, thoughtful, and test the same knowledge or skill as the original.
- Avoid introducing unrelated ideas or deviating from the original intent.

{format_instructions}
Return your answer **as a JSON array** with {variation_count} objects
`;
export const translateQuestionTemplate = `
Translate the following question into {target_language}. Ensure the output adheres to the specified JSON format.
Question: {question_text}
{format_instructions}
  `;

export const generateQuestionWithChoicesRewordingsTemplate = `
Generate {variation_count} creative variants of the following question and its associated choices:
Question: {question_text}
Choices: {choices_text}
Existing variants: {variants}

Your goal:
- Create distinct versions of the question and its choices, ensuring they remain relevant, meaningful, and aligned with the original intent.
- Change the question focus, structure, or context to make it feel fresh, while still testing the same concept or knowledge.
- Generate alternative choices where possible, replacing distractors (incorrect options) with new, plausible alternatives that fit the new question phrasing or context.
- Provide meaningful feedback for each choice in choice-based questions, ensuring they align with the reworded question.

Additional Notes:
- Correct answers should remain accurate but can be reworded or framed differently to align with the new question.
- Distractors should be realistic, thoughtfully created, and align with the topic, while differing slightly from the original distractors.
- Avoid trivial rephrasing; aim for medium-difference variations that are distinct but interchangeable with the original.
{format_instructions}
Return your answer **as a JSON array** with {variation_count} objects
`;

export const generateQuestionWithTrueFalseRewordingsTemplate = `
Generate {variation_count} creative variants of the following true/false question:
Question: {question_text}
Existing variants: {variants}

Goals:
- Maintain the same core concept or context while presenting fresh and engaging variations.
- Include both **true** and **false** statements, aiming for a balanced mix.
- For **false** statements, use plausible but incorrect alternatives.

Guidelines:
- Avoid trivial changes (e.g., simple negations or word swaps).
- Ensure factual accuracy for **true** statements and clear incorrectness for **false** ones.
- Keep the phrasing clear and concise.

{format_instructions}
Return your answer **as a JSON array** with {variation_count} objects
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
    You are an AI assistant helping the author create a set of choices for choice-based questions.
    Question: {question_json_array}
    {format_instructions}
    - If the question already has choices, then you need to make new different choices.
    - Each option has "choice" (answer), "isCorrect" (true/false), "points", and "feedback".
    - Provide clear and concise feedback for each choice.
    - Only one correct answer,and make the rest incorrect choices with zero points.
    - points should be in whole numbers.

  `;
export const generateMultipleBasedMarkingRubricTemplate = `
    You are an AI assistant helping the author create a scoring rubric for choice-based questions.
    Questions: {question_json_array}
    {format_instructions}
    - Each option has "choice" (answer), "isCorrect" (true/false), "points", and "feedback".
    - Provide clear and concise feedback for each choice.
    - At least two correct answers; assign negative points for incorrect choices as needed. 
    - points should be in whole numbers.
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
  {format_instructions}

  Format each rubric item as an object with:
  - "points" (listed in descending order, unique per item)
  - "description" (detailed evaluation criteria describing the quality level needed to achieve this score, in a descending waterfall style. Each score should represent a standalone quality level rather than cumulative features.)

  Focus areas:
  - Content relevance: Does the content directly address the question?
  - Clarity of explanation: Is the explanation easy to understand?
  - Quality of integration: How well is the content integrated with supporting information or analysis?

  the response type is {response_type}, tailor so it matches the response type.

  Focus on clear distinctions between correct, partially correct, and incorrect answers.
`;

export const generateDocumentFileUploadMarkingRubricTemplate = `
  Generate a scoring rubric for document file upload questions.
  {format_instructions}

  Format each rubric item as an object with:
  - "points" (listed in descending order, unique per item)
  - "description" (detailed evaluation criteria describing the quality level needed to achieve this score, in a descending waterfall style. Each score should represent a standalone quality level rather than cumulative features.)
  the response type is {response_type}, tailor so it matches the response type.
  Focus areas:
  - Content relevance: Does the document directly address the question or topic?
  - Organization: Is the document structured logically, with clear headings and flow?
  - Clarity and style: Is the document written clearly, free of grammatical errors, and in an appropriate tone?
  - Supporting details: Are there relevant examples, statistics, or citations that strengthen the arguments?
 
  return a valid JSON object

  Ensure that each score level represents a clear distinction in quality, without requiring lower criteria to be met before higher scores.
`;
export const generateLinkFileUploadMarkingRubricTemplate = `
  Generate a scoring rubric for link/file upload questions.
  {format_instructions}

  Format each rubric item as an object with:
  - "points" (listed in descending order, unique per item)
  - "description" (detailed evaluation criteria describing the quality level needed to achieve this score, in a descending waterfall style. Each score should represent a standalone quality level rather than cumulative features.)
  the response type is {response_type}, tailor so it matches the response type.
  Focus areas:
  - Relevance: Does the linked content directly address the question or topic?
  - Credibility: Is the source of the linked content reliable and trustworthy?
  - Clarity: Is the content of the link clear and easy to understand?
  - Integration: How well is the linked content integrated with the learner's response?
  - Supporting details: Does the linked content provide relevant examples, statistics, or evidence?
  return a valid JSON object
  Ensure that each score level represents a clear distinction in quality, without requiring lower criteria to be met before higher scores.
`;
export const generateImageFileUploadMarkingRubricTemplate = `
  Generate a scoring rubric for image file upload questions.
  {format_instructions}

  Format each rubric item as an object with:
  - "points" (listed in descending order, unique per item)
  - "description" (detailed evaluation criteria describing the quality level needed to achieve this score, in a descending waterfall style. Each score should represent a standalone quality level rather than cumulative features.)
  the response type is {response_type}, tailor so it matches the response type.
  Focus areas:
  - Relevance: Does the image directly support and enhance the answer to the question?
  - Clarity: Is the image clear, focused, and free of unnecessary elements?
  - Quality: Is the image of high quality, with appropriate resolution and no distortion?
  - Composition: Are elements within the image well-organized to effectively convey information?
  - Annotation and labeling: Are relevant parts of the image clearly labeled or annotated where needed?
  return a valid JSON object

  Ensure that each score level represents a clear distinction in quality, without requiring lower criteria to be met before higher scores.
`;

export const generateCodeFileUploadMarkingRubricTemplate = `
  Generate a scoring rubric for code file upload questions.
  {format_instructions}

  Format each rubric item as an object with:
  - "points" (listed in descending order, unique per item)
  - "description" (detailed evaluation criteria describing the quality level needed to achieve this score, in a descending waterfall style. Each score should represent a standalone quality level rather than cumulative features.)
  the response type is {response_type}, tailor so it matches the response type.
  Focus areas:
  - Functionality: Does the code work as intended and meet all requirements?
  - Code quality: Is the code well-structured, maintainable, and follows best practices?
  - Efficiency: Is the code optimized for performance and resource usage?
  - Error handling: Does the code handle possible errors gracefully?
  - Documentation and readability: Is the code easy to understand, with clear comments and naming conventions?
  return a valid JSON object
  Ensure that each score level represents a clear distinction in quality, without requiring lower criteria to be met before higher scores.
`;

export const gradeReportFileQuestionLlmTemplate = `
As an expert grader, review the uploaded report for the question:
{question}

Files:
{files}

Points Possible: {total_points}
Scoring Type: {scoring_type}
Criteria:
{scoring_criteria}

### Output:
Return results in this format:
{format_instructions}

Make sure your feedback is in language code: {language}  
Include reasons why you awarded the points you did and how the report quality influenced your decision.

> Provide concise, constructive feedback. Avoid providing solutions, but guide the learner on how to enhance their report effectively.
`;

export const gradeEssayFileQuestionLlmTemplate = `
As an expert grader, review the uploaded essay for the question:
{question}

Files:
{files}

Points Possible: {total_points}
Scoring Type: {scoring_type}
Criteria:
{scoring_criteria}

### Output:
Return results in this format:
{format_instructions}

Make sure your feedback is in language code: {language} 
Include reasons why you awarded the points you did and how the essay quality influenced your decision.
> Provide constructive feedback to guide improvement. Avoid providing solutions.
`;
export const gradePresentationFileQuestionLlmTemplate = `
You are an expert grader evaluating a presentation. 

**Question / Task**:
{question}

**Learner's Presentation Report**:
- **Transcript**: {transcript}
- **Speech Analysis Report**: {speechReport}
- **Content Analysis Report**: {contentReport}
- **Body Language Analysis**:
  - Score: {bodyLanguageScore}%
  - Explanation: {bodyLanguageExplanation}

**Additional Context**:
- Total Points Possible: {total_points}
- Scoring Type: {scoring_type}
- Grading Type: {grading_type}
- Criteria: {scoring_criteria}
- Assignment Instructions: {assignment_instructions}
- Previous Q&As: {previous_questions_and_answers}

Please do the following:
1. **Assess** how well the presentation met the requirements (content coverage, speech clarity, organization, body language effectiveness).
2. **Award Points** out of {total_points}, based on {scoring_type} and {scoring_criteria}.
3. **Provide Constructive Feedback**: 
   - If the presentation is strong overall, do not fabricate major flaws—highlight positives and offer minimal improvements.
   - If the presentation needs work, provide clear, actionable suggestions.

### Output:
Return results in **this exact format**:
{format_instructions}

Make sure your explanation justifies why you awarded those points and how the presentation quality influenced your decision. Be clear, concise, and constructive.
`;

export const gradeVideoFileQuestionLlmTemplate = `
As an expert grader, review the uploaded video for the question:
{question}

Files:
{files}

Points Possible: {total_points}
Scoring Type: {scoring_type}
Criteria:
{scoring_criteria}

### Output:
Return results in this format:
{format_instructions}

Make sure your feedback is in language code: {language}
Include reasons why you awarded the points you did and how the video quality influenced your decision.
`;
export const gradeAudioFileQuestionLlmTemplate = `
As an expert grader, review the uploaded audio file for the question:
{question}

Files:
{files}

Points Possible: {total_points}
Scoring Type: {scoring_type}
Criteria:
{scoring_criteria}

### Output:
Return results in this format:
{format_instructions}

You need to provide feedback in language code: {language}
You need to provide your reasons why you awarded the points you did and how the audio quality influenced your decision.
`;
export const gradeSpreadsheetFileQuestionLlmTemplate = `
As an expert grader, review the uploaded spreadsheet for the question:
{question}

Files:
{files}

Points Possible: {total_points}
Scoring Type: {scoring_type}
Criteria:
{scoring_criteria}

### Output:
Return results in this format:
{format_instructions}

You need to provide feedback in language code: {language}
Include reasons why you awarded the points you did and how the spreadsheet quality influenced your decision.
`;

export const liveRecordingFeedbackTemplate = `
You are a professional presentation coach. Analyze the following presentation details and provide **constructive, actionable feedback** to help the learner improve their presentation skills. 
If the learner is already doing very well, do not fabricate negative points; instead, briefly highlight strengths and offer minimal suggestions. If the learner did not perform well, be blunt and honest about the issues, but also provide constructive feedback on how to improve.

**Presentation Question:**
{question_text}

**Presentation Data (may be partial or missing certain fields)**:
"transcript": {live_recording_transcript},
"speechReport": {live_recording_speechReport},
"contentReport": {live_recording_contentReport},
"bodyLanguageScore": {live_recording_bodyLanguageScore},
"bodyLanguageExplanation": {live_recording_bodyLanguageExplanation}

Where provided:
- **Transcript**: AI-based speech transcription (possibly with typos).
- **Speech Report**: Clarity, pacing, filler words, etc.
- **Content Report**: Structure, depth, vocabulary complexity, etc.
- **Body Language**: Score and explanation of gestures, posture, eye contact, etc.

Your feedback should be free from ambiguity and jargon.
Stay constructive and try to be helpful. 

Your response must follow these format instructions exactly:
{format_instructions}
`;
export const gradeVideoPresenatationQuestionTemplate = `
You are an expert grader evaluating a video-based presentation.

**Question / Task**:
{question}

**Assignment Instructions**:
{assignment_instructions}

**Previous Q&A Context**:
{previous_questions_and_answers}

**Presentation Data**:
- **Transcript**: {transcript}
- **Slides Data:(these are all the information you need about the slides)**: {slidesData}

**Evaluation Criteria**:
- Total Points Available: {total_points}
- Scoring Type: {scoring_type}
- Scoring Criteria: {scoring_criteria}

**Grading Type**:
{grading_type}

Please do the following:
1. **Assess** how well the presentation met the requirements in terms of:
   - **Content Coverage & Clarity** (based on the transcript)
   - **Slide Usage** (if slidesData is provided)
   - **Organization and Overall Quality**
2. **Award Points** out of {total_points}, using {scoring_type} and {scoring_criteria} as guidance.
3. **Provide Constructive Feedback**:
   - If the presentation is strong, highlight positives and offer minimal improvements.
   - If it needs more work, give clear, actionable suggestions for transcript clarity and effective slide usage.
   - Keep your feedback positive, encouraging, and concise.

Remember:
- The transcript may contain AI-generated typos.
- The slidesData may contain text and/or images (potentially in base64). Dont evaluate visual aspects of the slides.
- Your feedback should be free from ambiguity and jargon.
- Your response must follow these format instructions exactly:
{format_instructions}
`;
