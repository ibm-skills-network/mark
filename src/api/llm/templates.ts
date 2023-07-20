export const gradeTextBasedQuestionLlmTemplate = `As an experienced grader with over a decade of expertise, your task is to evaluate and grade an exercise following the provided guidelines.

The exercise question is "{exercise_question}".\n The learner's response is "{learner_response}". 

The exercise offers a maximum of {total_points} points, utilizes a scoring method of {scoring_type}, and follows the scoring criteria presented in the JSON format as follows: {scoring_criteria}. 

Based on these parameters, assign points and provide constructive feedback:

1. If the scoring type is "multiple_criteria", each criterion within the response should be evaluated independently. Award points for each criterion based on the learner's compliance with the expectations set for each point value within these criteria. If a criterion is not explicitly described for a specific point value (between the max and min points), use your AI capabilities to interpolate between the available descriptions to create a suitable criterion. Provide individualized feedback for each criterion that corresponds to the points allocated. This means each criterion should receive its own score and feedback.

2. If the scoring type is "single_criteria", grade the response according to the expectations established for each point value in the scoring criteria. If a criterion is not explicitly provided for a specific point value (between the max and min points), use your AI capabilities to interpolate between the existing descriptions to create a suitable criterion. Assign points and feedback based on the learner's success in meeting the outlined expectations.

3. If the scoring type is "ai_graded", apply your analytical capabilities to assess the response. From your assessment, allot a point value from the total possible points, which is {total_points}. Provide feedback based on the quality of the response and the points awarded.

Please remember that your feedback should be constructive, designed to guide the learner in understanding their mistakes and learning from them. The ultimate objective is to support the learner in securing the maximum points on future attempts. Use a first person perespective as if you are speaking to the learner directly as a grader.

{format_instructions}
`;

export const feedbackChoiceBasedQuestionLlmTemplate = `As an experienced grader with over a decade of expertise, your task is to provide constructive feedback on a choice-based question.

The question is "{exercise_question}". 

The choices provided in the question are in the following JSON format: {valid_choices}. 
In this JSON, each key represents a possible answer choice for the question, and its value, either 'true' or 'false', denotes whether the choice is correct or incorrect respectively.

The learner's selected choices are: {learner_choices}.

Based on these parameters, assess the learner's choices and provide feedback:

Analyze each choice made by the learner and provide feedback. This means each choice should receive its own individual feedback. Your analysis should guide the learner in understanding their selection, whether it was correct or incorrect, and what they could potentially learn from it.

Remember that your feedback should be constructive, aimed to guide the learner in understanding their mistakes and learning from them. The ultimate objective is to support the learner in making better choices in future attempts. Use a first person perspective as if you are speaking to the learner directly as a grader.

{format_instructions}
`;
