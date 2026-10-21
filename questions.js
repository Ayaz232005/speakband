/* SpeakBand question banks — IELTS Speaking Parts 1–3.
   Working draft; expand and rotate regularly so repeat users get fresh prompts. */
"use strict";

const PART1_TOPICS = [
  { topic: "Home & Accommodation", questions: [
    "Do you live in a house or an apartment?",
    "What do you like most about your home?",
    "Is there anything you would like to change about your home?",
    "What kind of house would you like to live in in the future?",
  ]},
  { topic: "Work & Studies", questions: [
    "Do you work or are you a student?",
    "What do you like most about your studies / job?",
    "Is there anything difficult about your studies / job?",
    "What are your plans after you finish your studies?",
  ]},
  { topic: "Hometown", questions: [
    "Where is your hometown?",
    "What do you like most about your hometown?",
    "Has your hometown changed much in recent years?",
    "Would you like to live there in the future?",
  ]},
  { topic: "Food & Cooking", questions: [
    "What kind of food do you enjoy eating?",
    "Do you like cooking? Why or why not?",
    "What was the last meal you cooked?",
    "Do you prefer eating at home or in restaurants?",
  ]},
  { topic: "Travel & Holidays", questions: [
    "Do you like travelling?",
    "Where did you go on your last holiday?",
    "Do you prefer travelling alone or with others?",
    "What is the most interesting place you have visited?",
  ]},
  { topic: "Technology", questions: [
    "How much time do you spend on your phone each day?",
    "What is your favourite app, and why?",
    "Has technology changed the way you study or work?",
    "Do you think people depend too much on technology?",
  ]},
  { topic: "Friends & Family", questions: [
    "Do you spend a lot of time with your family?",
    "Who are you closest to in your family?",
    "Do you prefer spending time with family or friends?",
    "How do you usually spend time with your friends?",
  ]},
  { topic: "Health & Exercise", questions: [
    "Do you do any exercise regularly?",
    "What do you do to stay healthy?",
    "Do you think people exercise enough these days?",
    "What sport would you like to try?",
  ]},
  { topic: "Music", questions: [
    "What kind of music do you like?",
    "Do you play any musical instrument?",
    "Has your taste in music changed over the years?",
    "Do you prefer live concerts or listening at home?",
  ]},
  { topic: "Weather & Seasons", questions: [
    "What is the weather like in your country?",
    "What is your favourite season?",
    "Does the weather affect your mood?",
    "Would you like to live in a country with a different climate?",
  ]},
];

const PART2_CARDS = [
  { title: "A person who has influenced you",
    points: ["who this person is", "how you know them", "what they did", "and explain how they influenced you"] },
  { title: "A memorable journey you took",
    points: ["where you went", "who you went with", "what you did there", "and explain why it was memorable"] },
  { title: "A skill you would like to learn",
    points: ["what the skill is", "why you want to learn it", "how you would learn it", "and explain how it would help you"] },
  { title: "A book that made an impression on you",
    points: ["what the book is", "when you read it", "what it is about", "and explain why it impressed you"] },
  { title: "A place you would like to visit",
    points: ["where it is", "what you know about it", "what you would do there", "and explain why you want to visit"] },
  { title: "A gift you received",
    points: ["what the gift was", "who gave it to you", "when you received it", "and explain how you felt about it"] },
  { title: "A difficult decision you made",
    points: ["what the decision was", "when you made it", "what choices you had", "and explain why it was difficult"] },
  { title: "A traditional festival in your country",
    points: ["what the festival is", "when it is celebrated", "what people do", "and explain why it is important"] },
  { title: "An achievement you are proud of",
    points: ["what the achievement was", "when it happened", "what you did to achieve it", "and explain why you are proud"] },
  { title: "A piece of technology you find useful",
    points: ["what it is", "how you use it", "how long you have used it", "and explain why it is useful to you"] },
  { title: "A sport or game you enjoy",
    points: ["what it is", "when you started playing it", "who you play it with", "and explain why you enjoy it"] },
  { title: "A meal you enjoyed",
    points: ["what the meal was", "where you had it", "who you were with", "and explain why you enjoyed it"] },
];

const PART3_SETS = [
  { theme: "Influence & role models", questions: [
    "What qualities make a good role model?",
    "Do young people today have different role models than in the past?",
    "Should celebrities be expected to be role models?",
    "How can parents positively influence their children?",
  ]},
  { theme: "Travel & tourism", questions: [
    "What are the benefits of travelling to other countries?",
    "Do you think tourism harms the environment?",
    "How has travel changed in the last twenty years?",
    "Should governments promote domestic tourism?",
  ]},
  { theme: "Learning & skills", questions: [
    "What skills are most important for young people today?",
    "Is it better to learn a skill early in life or later?",
    "How has the internet changed the way people learn?",
    "Do you think practical skills are more useful than academic knowledge?",
  ]},
  { theme: "Culture & traditions", questions: [
    "Why is it important to preserve traditions?",
    "How are traditional festivals changing in modern society?",
    "Do you think globalisation threatens local cultures?",
    "What can young people learn from older generations?",
  ]},
  { theme: "Technology & society", questions: [
    "How has technology changed communication?",
    "Do the advantages of social media outweigh the disadvantages?",
    "Will artificial intelligence change the job market?",
    "Should children be allowed unlimited access to technology?",
  ]},
  { theme: "Health & lifestyle", questions: [
    "Why do you think obesity is increasing in many countries?",
    "Whose responsibility is it to keep children healthy — parents or schools?",
    "How can governments encourage healthier lifestyles?",
    "Do you think life is more stressful now than in the past?",
  ]},
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/* Build a full mock: 1 Part-1 topic (4 Qs), 1 Part-2 card, 1 Part-3 set. */
function buildFullMock() {
  const p1 = pickRandom(PART1_TOPICS);
  const p2 = pickRandom(PART2_CARDS);
  const p3 = pickRandom(PART3_SETS);
  return { part1: p1, part2: p2, part3: p3 };
}
