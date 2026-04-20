this is a multi-agent trip planner:  generates a complete travel plan based on user input such as destination, budget, and duration.


  user input
  choose source and destination
  choose budget 
  choose mode of travelling
  choose high,mid,low cost - travel style
  choose number of peoples
  any specifications like about food, stay ,place etc..


LLM + agent + tools + coordinator + memory

*System architecture* :
  > coordinator agent
  > travel agent
  > stay agent 
  > food agent
  > itinerary agent
  > budget agent

*Workflow* :
  User input->coordimator ->Agents-> tools/APIs -> Cost calculation -> optimization -> final plan


*Tech Stack*: 
  pyhton
  LangChain/CrewAI
  Hugging Face
  APIs(google maps , etc..)
  live weather with open-meteo(  ai return map_markers with lat/lng
                                                  ↓
                                  we take the first marker.s coordinates
                                                  ↓
                                  fetch open-metoo api with those coords
                                                  ↓
                                  get days forecast - temp, rain , wind, conditions
                                                  ↓
                                  show weather card above the itinerary                             )

also have option to choose cheap and best one. 
database for local save - supabase
    