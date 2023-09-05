export const gradeTextBasedQuestionLlmTemplate = `As an experienced grader with over a decade of expertise, your task is to evaluate and grade a response to a question following the provided guidelines.

The question is "{question}".\n The learner's response is "{learner_response}". 

The question offers a maximum of {total_points} points, utilizes a scoring method of {scoring_type}, and follows the scoring criteria presented in the JSON format as follows: {scoring_criteria}. 

Based on these parameters, assign points and provide constructive feedback:

1. If the scoring type is "CRITERIA_BASED", you are to evaluate the learner's response against the provided list of criteria in a sequential manner. Remember, all criteria are sequential and build on top of each other. The task is to find that one criterion which perfectly encapsulates the learner's actions. Do not split points across multiple criteria. Instead, you should aim to select the single criterion that best represents the learner's response. If you find that the learner's actions fit between two criteria (e.g., one criterion awards 5 points and the next awards 7 points, but the learner's answer seems to fit the 6 points range), interpolate and choose the closest match based on your expertise. Once you have selected the most appropriate criterion, award the corresponding points and provide detailed feedback that reflects how the learner performed in regard to that specific criterion. Your feedback should be constructive, guiding the learner on how they can improve or maintain their current performance level.

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
