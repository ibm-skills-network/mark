export const gradeTextBasedQuestionLlmTemplate = `As an experienced grader with over a decade of expertise, your task is to evaluate and grade a response to a question following the provided guidelines.

The question is "{question}".\n The learner's response is "{learner_response}". 

The question offers a maximum of {total_points} points, utilizes a scoring method of {scoring_type}, and follows the scoring criteria presented in the JSON format as follows: {scoring_criteria}. 

Based on these parameters, assign points and provide constructive feedback:

1. If the scoring type is "CRITERIA_BASED", you are to evaluate the learner's response against each of the listed criteria. For each criterion, award points based on the learner's adherence to the expectations described. Provide feedback corresponding to the points awarded for each criterion. This means you should give a separate score and specific feedback for each criterion, guiding the learner on how they performed in that specific area. If a criterion's performance description does not precisely match the learner's response, use your expertise to make a fair judgment and award points accordingly.

2. If the scoring type is "AI_GRADED", use your analytical capabilities to comprehensively assess the response. Based on your assessment, allocate points out of the possible {total_points}. Provide feedback detailing the quality of the learner's answer and the rationale behind the points awarded.

Ensure your feedback is constructive, helping the learner grasp their mistakes and learn from them. The overarching goal is to assist the learner in achieving the full point value in subsequent attempts. Speak to the learner directly in the first person, as if you are a grader communicating feedback.

{format_instructions}
`;

export const feedbackChoiceBasedQuestionLlmTemplate = `As an experienced grader with over a decade of expertise, your task is to provide constructive feedback on a choice-based question.

The question is "{question}". 

The choices provided in the question are in the following JSON format: {valid_choices}. 
In this JSON, each key represents a possible answer choice for the question, and its value, either 'true' or 'false', denotes whether the choice is correct or incorrect respectively.

The learner's selected choices are: {learner_choices}.

Based on these parameters, assess the learner's choices and provide feedback:

Analyze each choice made by the learner and provide feedback. This means each choice should receive its own individual feedback. Your analysis should guide the learner in understanding their selection, whether it was correct or incorrect, and what they could potentially learn from it.

Remember that your feedback should be constructive, aimed to guide the learner in understanding their mistakes and learning from them. The ultimate objective is to support the learner in making better choices in future attempts. Use a first person perspective as if you are speaking to the learner directly as a grader.

{format_instructions}
`;

export const feedbackTrueFalseBasedQuestionLlmTemplate = `As an experienced grader with over a decade of expertise, your task is to provide constructive feedback on a true false choice-based question.

The question is "{question}". 

The learner selected this choice: {learner_choice}.

The correct answer is: {answer}.

Based on this information, assess the learner's choice and provide feedback:

Your analysis should guide the learner in understanding their selection, whether it was correct or incorrect, and what they could potentially learn from it.

Remember that your feedback should be constructive, aimed to guide the learner in understanding their mistakes and learning from them. The ultimate objective is to support the learner in making better choices in future attempts. Use a first person perspective as if you are speaking to the learner directly as a grader.

{format_instructions}
`;
