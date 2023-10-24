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

Ensure your feedback is constructive, helping the learner understand their mistakes and learn from them. The overarching goal is to assist the learner in achieving the full point value in subsequent attempts. Speak to the learner directly in the first person, as if you are a grader communicating feedback.

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
