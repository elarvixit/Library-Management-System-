// Sample library members used by the demo seed and by `npm run add-members`.
// [name, phone, days since joining, active]
export const SAMPLE_MEMBERS = [
  ['Priya Sharma', '9845012345', 320, true],
  ['Rahul Verma', '9812345670', 290, true],
  ['Ananya Gupta', '9900112233', 260, true],
  ['Vikram Reddy', '9876012398', 240, true],
  ['Sneha Patel', '9822334455', 210, true],
  ['Karthik Nair', '9447012345', 200, true],
  ['Divya Menon', '9495567788', 185, true],
  ['Rohan Das', '9831098765', 170, true],
  ['Pooja Joshi', '9767123456', 150, true],
  ['Aditya Kulkarni', '9890456123', 140, true],
  ['Kavya Pillai', '9746123789', 120, true],
  ['Neha Kapoor', '9811987654', 110, true],
  ['Lakshmi Srinivasan', '9840765432', 95, true],
  ['Manish Agarwal', '9829012345', 80, true],
  ['Swati Mishra', '9935123456', 70, true],
  ['Imran Khan', '9869012345', 60, true],
  ['Harpreet Kaur', '9815234567', 50, true],
  ['John Mathew', '9447890123', 45, true],
  ['Sara DSouza', '9820456789', 35, true],
  ['Nikhil Bhat', '9480123456', 28, true],
  ['Tanvi Deshmukh', '9657890123', 20, true],
  ['Farhan Ali', '9700123456', 14, true],
  ['Gaurav Singh', '9711234567', 7, true],
  ['Meenakshi Sundaram', '9444987654', 400, false],
];

export const emailFor = (name) => `${name.toLowerCase().replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '.')}@example.com`;
